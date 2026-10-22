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
      : kind === "orders" ? await syncOrders(supabase)
      : await withAutoSales(supabase, await syncFinances(supabase, 45_000));
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
  // Las ventas que la sincronización ya descontó sola no se vuelven a contar
  const { data: autoSales } = await supabase.from("inventory_movements").select("product_id, qty, occurred_on")
    .eq("location", "amazon_fba").eq("reference", "Ventas Amazon (auto)");
  for (const m of autoSales ?? []) {
    const s0 = since.get(m.product_id);
    if (s0 && m.occurred_on < s0) continue;
    soldNet.set(m.product_id, (soldNet.get(m.product_id) ?? 0) + m.qty);
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
 * Descuenta del inventario en Amazon las unidades vendidas, un movimiento por producto y día.
 * Solo cuenta ventas posteriores al último cierre o cuadre manual de cada producto, para no descontar dos veces.
 */
async function autoSalesMovements(supabase: Supa) {
  const [{ data: listings }, { data: sales }] = await Promise.all([
    supabase.from("amazon_listings").select("sku, product_id").not("product_id", "is", null),
    supabase.from("inventory_movements").select("id, product_id, reference, created_at, occurred_on, qty").eq("location", "amazon_fba").eq("movement", "sale"),
  ]);
  const productOf = new Map((listings ?? []).map((l) => [l.sku, l.product_id as string]));
  const cutoff = new Map<string, string>();
  const auto = new Map<string, { id: string; qty: number }>();
  for (const m of sales ?? []) {
    if (m.reference === AUTO_REF) auto.set(`${m.product_id}|${m.occurred_on}`, { id: m.id, qty: m.qty });
    else if (!cutoff.has(m.product_id) || m.created_at > cutoff.get(m.product_id)!) cutoff.set(m.product_id, m.created_at);
  }

  const evs: { sku: string; quantity: number | null; posted_date: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("amazon_financial_events").select("sku, quantity, posted_date")
      .eq("event_type", "shipment").in("sku", [...productOf.keys()]).order("id").range(from, from + 999);
    evs.push(...((data ?? []) as typeof evs));
    if ((data ?? []).length < 1000) break;
  }
  const want = new Map<string, number>();
  for (const e of evs) {
    const pid = productOf.get(e.sku)!;
    const c = cutoff.get(pid);
    if (c && e.posted_date <= c) continue;
    const day = amazonDay(e.posted_date); // día según Amazon (hora del Pacífico)
    const k = `${pid}|${day}`;
    want.set(k, (want.get(k) ?? 0) - Number(e.quantity ?? 0));
  }

  let added = 0;
  for (const [k, qty] of want) {
    const [product_id, day] = k.split("|");
    const cur = auto.get(k);
    if (cur && cur.qty === qty) continue;
    if (cur) await supabase.from("inventory_movements").update({ qty }).eq("id", cur.id);
    else await supabase.from("inventory_movements").insert({ product_id, location: "amazon_fba", movement: "sale", qty, occurred_on: day,
      channel: "amazon", reference: AUTO_REF, notes: "Unidades despachadas por Amazon ese día (se actualiza al sincronizar)." });
    added += -(qty - (cur?.qty ?? 0));
  }
  return added;
}
