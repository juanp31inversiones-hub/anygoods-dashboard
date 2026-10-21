"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncFinances, syncInventory, syncPayouts, testConnection } from "@/lib/amazon/sync";

export type SyncResult = { ok: boolean; message: string; complete?: boolean };

async function memberClient() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_partner");
  if (!data) throw new Error("Sin acceso.");
  return supabase;
}

export async function runAmazon(kind: "connection" | "inventory" | "finances" | "payouts"): Promise<SyncResult> {
  try {
    const supabase = await memberClient();
    const res = kind === "connection" ? await testConnection(supabase)
      : kind === "inventory" ? await syncInventory(supabase)
      : kind === "payouts" ? await syncPayouts(supabase)
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
 * Cuadra las unidades en Amazon FBA del sistema con lo que reporta Amazon
 * (disponible + reservado + no vendible + en investigación). La diferencia negativa se registra como venta.
 */
export async function reconcileFba(productId?: string): Promise<SyncResult> {
  const supabase = await memberClient();
  const [{ data: listings }, { data: inv }, { data: moves }] = await Promise.all([
    supabase.from("amazon_listings").select("sku, product_id").not("product_id", "is", null),
    supabase.from("amazon_inventory").select("sku, fulfillable, reserved, unfulfillable, researching, synced_at"),
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

  // Ventas netas según Amazon desde el último cuadre de cada producto: la diferencia que no explican es un faltante.
  const { data: lastCuadre } = await supabase.from("inventory_movements").select("product_id, occurred_on")
    .eq("location", "amazon_fba").in("reference", ["Cuadre con Amazon", "Ventas Amazon (SP-API)"]).order("occurred_on", { ascending: false });
  const since = new Map<string, string>();
  for (const c of lastCuadre ?? []) if (!since.has(c.product_id)) since.set(c.product_id, c.occurred_on);
  const skuProduct = new Map((listings ?? []).map((l) => [l.sku, l.product_id!]));
  const evs: { sku: string; event_type: string; quantity: number | null; posted_date: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("amazon_financial_events").select("sku, event_type, quantity, posted_date")
      .in("event_type", ["shipment", "refund"]).in("sku", [...skuProduct.keys()]).order("id").range(from, from + 999);
    evs.push(...((data ?? []) as typeof evs));
    if ((data ?? []).length < 1000) break;
  }
  const soldNet = new Map<string, number>();
  for (const e of evs) {
    const pid = skuProduct.get(e.sku)!;
    const s0 = since.get(pid);
    if (s0 && e.posted_date.slice(0, 10) <= s0) continue;
    soldNet.set(pid, (soldNet.get(pid) ?? 0) + (e.event_type === "shipment" ? 1 : -1) * Number(e.quantity ?? 0));
  }

  const today = new Date().toISOString().slice(0, 10);
  const base = { location: "amazon_fba", occurred_on: today, channel: "amazon" };
  const rows = [...amazon.entries()]
    .filter(([pid]) => !productId || pid === productId)
    .flatMap(([pid, a]) => {
      const diff = a - (system.get(pid) ?? 0);
      if (diff === 0) return [];
      if (diff > 0) return [{ ...base, product_id: pid, qty: diff, movement: "adjustment", reference: "Cuadre con Amazon", notes: "Amazon reporta más unidades que el sistema" }];
      const sold = Math.min(-diff, Math.max(0, soldNet.get(pid) ?? 0));
      const missing = -diff - sold;
      return [
        ...(sold ? [{ ...base, product_id: pid, qty: -sold, movement: "sale", reference: "Cuadre con Amazon", notes: "Ventas netas según los eventos financieros de Amazon" }] : []),
        ...(missing ? [{ ...base, product_id: pid, qty: -missing, movement: "adjustment", reference: "Cuadre con Amazon", notes: "Faltante: Amazon tiene menos unidades de las que explican las ventas. Revisar recepción, pérdidas o retiros y reclamar si aplica." }] : []),
      ];
    });
  if (!rows.length) return { ok: true, message: "El inventario FBA ya coincide con Amazon." };
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/amazon");
  revalidatePath("/inventario");
  const sold = rows.filter((r) => r.movement === "sale").reduce((a, r) => a - r.qty, 0);
  const missing = rows.filter((r) => r.movement === "adjustment" && r.qty < 0).reduce((a, r) => a - r.qty, 0);
  return { ok: true, message: `Inventario cuadrado con Amazon: ${sold} und vendidas${missing ? ` y ${missing} und faltantes (revisar y reclamar)` : ""}.` };
}
