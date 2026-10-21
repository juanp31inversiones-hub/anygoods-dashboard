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

  const today = new Date().toISOString().slice(0, 10);
  const rows = [...amazon.entries()]
    .filter(([pid]) => !productId || pid === productId)
    .map(([pid, a]) => ({ pid, diff: a - (system.get(pid) ?? 0) }))
    .filter((r) => r.diff !== 0)
    .map((r) => ({
      product_id: r.pid, location: "amazon_fba", qty: r.diff, occurred_on: today, channel: "amazon",
      movement: r.diff < 0 ? "sale" : "adjustment",
      reference: "Cuadre con Amazon",
      notes: r.diff < 0 ? "Unidades vendidas en Amazon según el inventario FBA reportado" : "Amazon reporta más unidades que el sistema",
    }));
  if (!rows.length) return { ok: true, message: "El inventario FBA ya coincide con Amazon." };
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/amazon");
  revalidatePath("/inventario");
  const sold = rows.filter((r) => r.qty < 0).reduce((a, r) => a - r.qty, 0);
  return { ok: true, message: `Inventario cuadrado con Amazon: ${sold} unidades registradas como vendidas en ${rows.length} producto(s).` };
}
