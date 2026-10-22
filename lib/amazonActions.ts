"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncFinances, syncInventory, syncPayouts, testConnection } from "@/lib/amazon/sync";
import { AMAZON_TO_APP_STATUS, syncInbound, type InboundItem } from "@/lib/amazon/inbound";
import { syncOrders } from "@/lib/amazon/orders";
import { saveFbaShipment, type FbaShipmentPayload } from "@/lib/actions";
import { loadShipmentPayload } from "@/lib/shipmentPayload";
import { amazonDay } from "@/lib/tz";

export type SyncResult = { ok: boolean; message: string; complete?: boolean };

async function memberClient() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_partner");
  if (!data) throw new Error("Sin acceso.");
  return supabase;
}

export async function runAmazon(kind: "connection" | "inventory" | "finances" | "payouts" | "inbound" | "orders"): Promise<SyncResult> {
  try {
    const supabase = await memberClient();
    const res = kind === "connection" ? await testConnection(supabase)
      : kind === "inventory" ? await syncInventory(supabase)
      : kind === "payouts" ? await syncPayouts(supabase)
      : kind === "inbound" ? await syncInboundAndApply(supabase)
      : kind === "orders" ? await withAutoSales(supabase, await syncOrders(supabase))
      : await syncFinances(supabase, 45_000);
    revalidatePath("/amazon");
    return res;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Vincula un SKU de Amazon a un producto; si el producto no tiene ASIN, toma el del SKU. */
export async function linkSku(sku: string, productId: string | null): Promise<SyncResult> {
  const supabase = await memberClient();
  const { data: listing } = await supabase.from("amazon_listings").select("asin").eq("sku", sku).single();
  const { error } = await supabase.from("amazon_listings").update({ product_id: productId }).eq("sku", sku);
  if (error) return { ok: false, message: error.message };
  if (productId && listing?.asin) {
    await supabase.from("products").update({ asin: listing.asin }).eq("id", productId).is("asin", null);
  }
  revalidatePath("/amazon");
  return { ok: true, message: "SKU vinculado" };
}

/**
 * Cuadra las unidades en Amazon de la app con lo que reporta Amazon (disponible + reservado + no vendible + en investigación).
 * Primero descuenta los pedidos despachados que falten; lo que siga sin cuadrar es una diferencia real (faltante o sobrante).
 * Solo productos activos: los antiguos ya están cerrados.
 */
export async function reconcileFba(productId?: string): Promise<SyncResult> {
  const supabase = await memberClient();
  await autoSalesMovements(supabase);
  const [{ data: listings }, { data: inv }, { data: moves }] = await Promise.all([
    supabase.from("amazon_listings").select("sku, product_id, products!inner(active)").not("product_id", "is", null).eq("products.active", true),
    supabase.from("amazon_inventory").select("sku, fulfillable, reserved, unfulfillable, researching"),
    supabase.from("inventory_movements").select("product_id, qty").eq("location", "amazon_fba"),
  ]);
  const invBySku = new Map((inv ?? []).map((i) => [i.sku, i]));
  const amazon = new Map<string, number>();
  for (const l of listings ?? []) {
    const i = invBySku.get(l.sku);
    if (!i) continue;
    amazon.set(l.product_id!, (amazon.get(l.product_id!) ?? 0) + i.fulfillable + i.reserved + i.unfulfillable + i.researching);
  }
  const system = new Map<string, number>();
  for (const m of moves ?? []) system.set(m.product_id, (system.get(m.product_id) ?? 0) + m.qty);

  const base = { location: "amazon_fba", occurred_on: amazonDay(Date.now()), channel: "amazon", movement: "adjustment", reference: "Cuadre con Amazon" };
  const rows = [...amazon.entries()]
    .filter(([pid]) => !productId || pid === productId)
    .map(([pid, a]) => ({ pid, diff: a - (system.get(pid) ?? 0) }))
    .filter((r) => r.diff !== 0)
    .map((r) => ({ ...base, product_id: r.pid, qty: r.diff,
      notes: r.diff < 0
        ? "Faltante: Amazon tiene menos unidades de las que explican los pedidos despachados. Revisar pérdidas o retiros y reclamar."
        : "Amazon reporta más unidades que la app (por ejemplo, devoluciones de clientes que volvieron al inventario)." }));
  if (!rows.length) return { ok: true, message: "El inventario en Amazon ya coincide con la app." };
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/amazon");
  revalidatePath("/inventario");
  const missing = rows.filter((r) => r.qty < 0).reduce((a, r) => a - r.qty, 0);
  const extra = rows.filter((r) => r.qty > 0).reduce((a, r) => a + r.qty, 0);
  return { ok: true, message: `Cuadrado con Amazon${missing ? `: ${missing} und faltantes (revisar y reclamar)` : ""}${extra ? `${missing ? "," : ":"} ${extra} und de más` : ""}.` };
}

// ===== Envíos a Amazon (Fulfillment Inbound) =====
type Supa = Awaited<ReturnType<typeof memberClient>>;

/** Unidades enviadas y recibidas por producto, sumando los SKUs de cada producto. */
async function itemsByProduct(supabase: Supa, items: InboundItem[]) {
  const { data: listings } = await supabase.from("amazon_listings").select("sku, product_id").in("sku", items.map((i) => i.sku));
  const productOf = new Map((listings ?? []).map((l) => [l.sku, l.product_id as string | null]));
  const out = new Map<string, { shipped: number; received: number }>();
  const unlinked: string[] = [];
  for (const it of items) {
    const pid = productOf.get(it.sku);
    if (!pid) { unlinked.push(it.sku); continue; }
    const a = out.get(pid) ?? { shipped: 0, received: 0 };
    a.shipped += it.shipped;
    a.received += it.received;
    out.set(pid, a);
  }
  return { byProduct: out, unlinked };
}

/** Pasa a un envío de la app el estado, centro y unidades recibidas que reporta Amazon. */
function applyAmazon(p: FbaShipmentPayload, a: { shipment_id: string; name: string | null; destination_fc: string | null; status: string },
  byProduct: Map<string, { shipped: number; received: number }>): FbaShipmentPayload {
  const status = AMAZON_TO_APP_STATUS[a.status] ?? p.status;
  const receiving = status === "receiving" || status === "closed";
  return {
    ...p,
    shipment_id: a.shipment_id,
    destination_fc: a.destination_fc ?? p.destination_fc,
    name: p.name || a.name || "",
    status,
    items: p.items.map((it) => {
      const amz = byProduct.get(it.product_id);
      return amz && receiving ? { ...it, qty_received: String(amz.received) } : it;
    }),
  };
}

async function syncInboundAndApply(supabase: Supa): Promise<SyncResult> {
  const { total } = await syncInbound(supabase);
  const [{ data: amz }, { data: app }] = await Promise.all([
    supabase.from("amazon_inbound_shipments").select("shipment_id, name, destination_fc, status, items"),
    supabase.from("fba_shipments").select("id, shipment_id").not("shipment_id", "is", null),
  ]);
  const byId = new Map((amz ?? []).map((a) => [a.shipment_id, a]));
  let updated = 0;
  for (const s of app ?? []) {
    const a = byId.get(s.shipment_id!);
    const p = a && (await loadShipmentPayload(supabase, s.id));
    if (!a || !p) continue;
    const { byProduct } = await itemsByProduct(supabase, a.items as InboundItem[]);
    const next = applyAmazon(p, a, byProduct);
    if (JSON.stringify(next) === JSON.stringify(p)) continue;
    const r = await saveFbaShipment(next);
    if (r?.id) updated++;
  }
  const pending = (amz ?? []).filter((a) => !(app ?? []).some((s) => s.shipment_id === a.shipment_id)).length;
  revalidatePath("/envios");
  return { ok: true, message: `${total} envíos en Amazon; ${updated} actualizados en la app${pending ? `; ${pending} sin registrar` : ""}.` };
}

/**
 * Registra en la app un envío creado en Amazon: lo vincula a un envío existente (sin Shipment ID)
 * o crea uno nuevo con sus productos, sacando las unidades de la ubicación de origen elegida.
 */
export async function registerAmazonShipment(amazonId: string, fromLocation: string, appShipmentId?: string): Promise<SyncResult> {
  const supabase = await memberClient();
  const { data: a } = await supabase.from("amazon_inbound_shipments").select("*").eq("shipment_id", amazonId).single();
  if (!a) return { ok: false, message: "Envío de Amazon no encontrado. Sincroniza de nuevo." };
  const { byProduct, unlinked } = await itemsByProduct(supabase, a.items as InboundItem[]);
  if (unlinked.length) return { ok: false, message: `Primero vincula estos SKUs a un producto (Amazon → SKUs): ${unlinked.join(", ")}` };

  let base: FbaShipmentPayload | null;
  if (appShipmentId) {
    base = await loadShipmentPayload(supabase, appShipmentId);
    if (!base) return { ok: false, message: "Envío de la app no encontrado." };
  } else {
    const day = a.shipped_on ?? new Date().toISOString().slice(0, 10);
    base = {
      shipment_id: "", name: "", destination_fc: "", from_location: fromLocation, status: "working",
      created_on: day, shipped_on: day, closed_on: "", carrier: "amazon_partnered", tracking: "", boxes: "", weight_lb: "", notes: "",
      items: [...byProduct.entries()].map(([product_id, q]) => ({ product_id, qty_shipped: String(q.shipped), qty_received: "" })),
      costs: [],
    };
  }
  const next = applyAmazon(base, a, byProduct);
  if (next.status === "closed" && !next.closed_on) next.closed_on = next.shipped_on || next.created_on;
  const r = await saveFbaShipment(next);
  if (r?.error) return { ok: false, message: r.error };
  revalidatePath("/envios");
  return { ok: true, message: appShipmentId ? "Envío vinculado con Amazon." : "Envío registrado." };
}

/** Oculta (o vuelve a mostrar) un envío de Amazon que no se quiere registrar, ej. envíos antiguos ya cerrados. */
export async function ignoreAmazonShipment(amazonId: string, ignored = true): Promise<SyncResult> {
  const supabase = await memberClient();
  const { error } = await supabase.from("amazon_inbound_shipments").update({ ignored }).eq("shipment_id", amazonId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/envios");
  return { ok: true, message: ignored ? "Envío ocultado." : "Envío visible." };
}

// ===== Ventas de Amazon → inventario (automático) =====
const AUTO_REF = "Ventas Amazon (auto)";

async function withAutoSales(supabase: Supa, r: SyncResult): Promise<SyncResult> {
  if (!r.ok || !r.complete) return r;
  const n = await autoSalesMovements(supabase);
  revalidatePath("/inventario");
  revalidatePath("/");
  return n ? { ...r, message: `${r.message} · ${n} unidades vendidas descontadas del inventario` } : r;
}

/**
 * Descuenta del inventario en Amazon cada pedido que Amazon ya despachó (no espera al pago, que Amazon puede retener días).
 * Cada pedido se cuenta una sola vez (amazon_orders.inventory_counted); un movimiento por producto y día de compra.
 */
async function autoSalesMovements(supabase: Supa) {
  const [{ data: orders }, { data: listings }] = await Promise.all([
    supabase.from("amazon_orders").select("order_id, purchase_date, items").eq("status", "Shipped").eq("items_synced", true).eq("inventory_counted", false),
    supabase.from("amazon_listings").select("sku, product_id, products!inner(active)").not("product_id", "is", null).eq("products.active", true),
  ]);
  if (!orders?.length) return 0;
  const productOf = new Map((listings ?? []).map((l) => [l.sku, l.product_id as string]));
  const byDay = new Map<string, number>();
  for (const o of orders) {
    for (const i of o.items as { sku: string; qty: number }[]) {
      const pid = productOf.get(i.sku);
      if (!pid || !i.qty) continue; // productos inactivos: su inventario ya está cerrado
      const k = `${pid}|${amazonDay(o.purchase_date)}`;
      byDay.set(k, (byDay.get(k) ?? 0) + i.qty);
    }
  }
  let units = 0;
  for (const [k, qty] of byDay) {
    const [product_id, day] = k.split("|");
    const { error } = await supabase.from("inventory_movements").insert({ product_id, location: "amazon_fba", movement: "sale", qty: -qty, occurred_on: day,
      channel: "amazon", reference: AUTO_REF, notes: "Pedidos despachados por Amazon (se registra al sincronizar)." });
    if (error) throw new Error(error.message);
    units += qty;
  }
  await supabase.from("amazon_orders").update({ inventory_counted: true }).in("order_id", orders.map((o) => o.order_id));
  return units;
}
