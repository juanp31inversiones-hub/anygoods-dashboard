import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MARKETPLACE_ID, spGet } from "@/lib/amazon/spapi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HISTORY_DAYS = 100; // alcanza para "Este mes", "Mes pasado" y "90 días"

type Order = { AmazonOrderId: string; PurchaseDate: string; LastUpdateDate?: string; OrderStatus: string; FulfillmentChannel?: string; OrderTotal?: { Amount?: string } };
type OrderItem = { SellerSKU?: string; ASIN?: string; Title?: string; QuantityOrdered?: number; ItemPrice?: { Amount?: string } };
export type OrderLine = { sku: string; asin: string | null; title: string | null; qty: number; price: number | null };

/**
 * Pedidos por fecha de compra (como "Units ordered" y "Sales" de Seller Central).
 * Trae los pedidos actualizados desde la última vez y luego sus productos, con límite de tiempo por ejecución.
 */
export async function syncOrders(supabase: SupabaseClient, budgetMs = 45_000) {
  const started = Date.now();
  const { data: st } = await supabase.from("amazon_sync_state").select("value").eq("key", "orders").maybeSingle();
  const since = (st?.value as { updated_after?: string } | undefined)?.updated_after
    ?? new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const until = new Date(Date.now() - 3 * 60_000).toISOString();

  // 1. Pedidos nuevos o con cambios
  const orders: Order[] = [];
  let next: string | undefined;
  do {
    const res = await spGet<{ payload?: { Orders?: Order[]; NextToken?: string } }>("/orders/v0/orders", next
      ? { MarketplaceIds: MARKETPLACE_ID, NextToken: next }
      : { MarketplaceIds: MARKETPLACE_ID, LastUpdatedAfter: since, LastUpdatedBefore: until, MaxResultsPerPage: "100" });
    orders.push(...(res.payload?.Orders ?? []));
    next = res.payload?.NextToken;
  } while (next);

  if (orders.length) {
    const { data: known } = await supabase.from("amazon_orders").select("order_id, status").in("order_id", orders.map((o) => o.AmazonOrderId));
    const prev = new Map((known ?? []).map((k) => [k.order_id, k.status]));
    const rows = orders.map((o) => ({
      order_id: o.AmazonOrderId, purchase_date: o.PurchaseDate, status: o.OrderStatus, fulfillment_channel: o.FulfillmentChannel ?? null,
      order_total: o.OrderTotal?.Amount ? Number(o.OrderTotal.Amount) : null, last_update: o.LastUpdateDate ?? null, synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("amazon_orders").upsert(rows, { onConflict: "order_id" });
    if (error) throw new Error(error.message);
    // Los productos se vuelven a leer si el pedido es nuevo o cambió de estado (los pendientes no traen precio)
    const changed = orders.filter((o) => prev.get(o.AmazonOrderId) !== o.OrderStatus).map((o) => o.AmazonOrderId);
    if (changed.length) await supabase.from("amazon_orders").update({ items_synced: false }).in("order_id", changed);
  }
  await supabase.from("amazon_sync_state").upsert({ key: "orders", value: { updated_after: until }, updated_at: new Date().toISOString() });

  // 2. Productos de cada pedido pendiente de leer (límite de Amazon: 0.5 por segundo)
  const { data: pending } = await supabase.from("amazon_orders").select("order_id").eq("items_synced", false).order("purchase_date", { ascending: false });
  let done = 0;
  for (const { order_id } of pending ?? []) {
    if (Date.now() - started > budgetMs) break;
    const items: OrderLine[] = [];
    let token: string | undefined;
    do {
      const res = await spGet<{ payload?: { OrderItems?: OrderItem[]; NextToken?: string } }>(`/orders/v0/orders/${order_id}/orderItems`, token ? { NextToken: token } : {});
      for (const i of res.payload?.OrderItems ?? []) {
        items.push({ sku: i.SellerSKU ?? "", asin: i.ASIN ?? null, title: i.Title ?? null, qty: i.QuantityOrdered ?? 0,
          price: i.ItemPrice?.Amount ? Number(i.ItemPrice.Amount) : null });
      }
      token = res.payload?.NextToken;
      await sleep(done < 25 ? 300 : 2100);
    } while (token);
    await supabase.from("amazon_orders").update({ items, items_synced: true }).eq("order_id", order_id);
    done++;
  }
  const remaining = (pending?.length ?? 0) - done;
  return {
    ok: true,
    complete: remaining <= 0,
    message: remaining > 0 ? `Pedidos: ${done} leídos, faltan ${remaining}. Sigue sincronizando…` : `Pedidos al día (${orders.length} nuevos o con cambios).`,
  };
}
