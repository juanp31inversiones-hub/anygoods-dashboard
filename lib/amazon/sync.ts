import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MARKETPLACE_ID, SpApiError, spGet } from "./spapi";

type Money = { CurrencyAmount?: number } | undefined;
const amt = (m: Money) => Number(m?.CurrencyAmount ?? 0);
const round = (n: number) => Math.round(n * 100) / 100;
const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 20);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fecha desde la que se trae el historial la primera vez. */
const HISTORY_START = "2025-04-01T00:00:00Z";
/** Amazon permite como máximo 180 días por consulta de eventos financieros. */
const WINDOW_DAYS = 90;

async function logRun(supabase: SupabaseClient, kind: string) {
  const { data } = await supabase.from("amazon_sync_runs").insert({ kind }).select("id").single();
  return async (status: "ok" | "partial" | "error", records: number, message: string) => {
    if (data) await supabase.from("amazon_sync_runs").update({ status, records, message, finished_at: new Date().toISOString() }).eq("id", data.id);
  };
}

// ===== Conexión =====
export async function testConnection(supabase: SupabaseClient) {
  const finish = await logRun(supabase, "connection");
  try {
    const res = await spGet<{ payload: { marketplace: { id: string; name: string }; participation: { isParticipating: boolean } }[] }>(
      "/sellers/v1/marketplaceParticipations",
    );
    const markets = res.payload.filter((p) => p.participation?.isParticipating).map((p) => p.marketplace.name);
    const msg = `Conectado. Marketplaces activos: ${markets.join(", ") || "ninguno"}`;
    await finish("ok", markets.length, msg);
    return { ok: true, message: msg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("error", 0, msg);
    return { ok: false, message: msg };
  }
}

// ===== Inventario FBA =====
type InvSummary = {
  asin?: string; fnSku?: string; sellerSku: string; productName?: string; totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number; inboundWorkingQuantity?: number; inboundShippedQuantity?: number; inboundReceivingQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: number };
    researchingQuantity?: { totalResearchingQuantity?: number };
  };
};

export async function syncInventory(supabase: SupabaseClient) {
  const finish = await logRun(supabase, "inventory");
  try {
    const all: InvSummary[] = [];
    let nextToken: string | undefined;
    do {
      const res = await spGet<{ payload?: { inventorySummaries: InvSummary[] }; pagination?: { nextToken?: string } }>(
        "/fba/inventory/v1/summaries",
        { details: "true", granularityType: "Marketplace", granularityId: MARKETPLACE_ID, marketplaceIds: MARKETPLACE_ID, nextToken },
      );
      all.push(...(res.payload?.inventorySummaries ?? []));
      nextToken = res.pagination?.nextToken;
      if (nextToken) await sleep(600);
    } while (nextToken);

    if (all.length) {
      const now = new Date().toISOString();
      const listings = all.map((s) => ({ sku: s.sellerSku, asin: s.asin ?? null, fnsku: s.fnSku ?? null, title: s.productName ?? null, updated_at: now }));
      const l = await supabase.from("amazon_listings").upsert(listings, { onConflict: "sku" });
      if (l.error) throw new Error(l.error.message);
      const inv = all.map((s) => {
        const d = s.inventoryDetails ?? {};
        return {
          sku: s.sellerSku,
          fulfillable: d.fulfillableQuantity ?? 0,
          inbound_working: d.inboundWorkingQuantity ?? 0,
          inbound_shipped: d.inboundShippedQuantity ?? 0,
          inbound_receiving: d.inboundReceivingQuantity ?? 0,
          reserved: d.reservedQuantity?.totalReservedQuantity ?? 0,
          unfulfillable: d.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0,
          researching: d.researchingQuantity?.totalResearchingQuantity ?? 0,
          total: s.totalQuantity ?? 0,
          synced_at: now,
        };
      });
      const i = await supabase.from("amazon_inventory").upsert(inv, { onConflict: "sku" });
      if (i.error) throw new Error(i.error.message);
      await autoLinkListings(supabase);
    }
    const msg = `${all.length} SKUs con inventario FBA actualizados`;
    await finish("ok", all.length, msg);
    return { ok: true, message: msg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("error", 0, msg);
    return { ok: false, message: msg };
  }
}

/** Vincula SKUs a productos por ASIN cuando todavía no tienen producto. */
export async function autoLinkListings(supabase: SupabaseClient) {
  const [{ data: listings }, { data: products }] = await Promise.all([
    supabase.from("amazon_listings").select("sku, asin").is("product_id", null).not("asin", "is", null),
    supabase.from("products").select("id, asin").not("asin", "is", null),
  ]);
  const byAsin = new Map((products ?? []).map((p) => [String(p.asin).toUpperCase(), p.id]));
  for (const l of listings ?? []) {
    const pid = byAsin.get(String(l.asin).toUpperCase());
    if (pid) await supabase.from("amazon_listings").update({ product_id: pid }).eq("sku", l.sku);
  }
}

// ===== Eventos financieros =====
type Charge = { ChargeType?: string; ChargeAmount?: Money };
type Fee = { FeeType?: string; FeeAmount?: Money };
type Item = {
  SellerSKU?: string; OrderItemId?: string; OrderAdjustmentItemId?: string; QuantityShipped?: number;
  ItemChargeList?: Charge[]; ItemChargeAdjustmentList?: Charge[];
  ItemFeeList?: Fee[]; ItemFeeAdjustmentList?: Fee[];
  PromotionList?: { PromotionAmount?: Money }[]; PromotionAdjustmentList?: { PromotionAmount?: Money }[];
  ItemTaxWithheldList?: { TaxesWithheld?: Charge[] }[];
};
type ShipEvent = { AmazonOrderId?: string; PostedDate?: string; ShipmentItemList?: Item[]; ShipmentItemAdjustmentList?: Item[] };
export type EventRow = {
  id: string; event_type: string; posted_date: string; order_id: string | null; sku: string | null; quantity: number | null;
  principal: number; tax: number; shipping: number; promotion: number; fba_fee: number; referral_fee: number; other_fees: number;
  total: number; description: string | null; raw: unknown;
};

const FBA_FEES = new Set(["FBAPerUnitFulfillmentFee", "FBAPerOrderFulfillmentFee", "FBAWeightBasedFee"]);
const REFERRAL_FEES = new Set(["Commission", "VariableClosingFee", "FixedClosingFee", "RefundCommission"]);

function itemRow(type: string, ev: ShipEvent, it: Item, idx: number): EventRow {
  const r = { principal: 0, tax: 0, shipping: 0, promotion: 0, fba_fee: 0, referral_fee: 0, other_fees: 0 };
  for (const c of [...(it.ItemChargeList ?? []), ...(it.ItemChargeAdjustmentList ?? [])]) {
    const v = amt(c.ChargeAmount);
    const t = c.ChargeType ?? "";
    if (t === "Principal") r.principal += v;
    else if (/Tax/i.test(t)) r.tax += v;
    else if (/Shipping|GiftWrap/i.test(t)) r.shipping += v;
    else r.other_fees += v;
  }
  for (const f of [...(it.ItemFeeList ?? []), ...(it.ItemFeeAdjustmentList ?? [])]) {
    const v = amt(f.FeeAmount);
    const t = f.FeeType ?? "";
    if (FBA_FEES.has(t)) r.fba_fee += v;
    else if (REFERRAL_FEES.has(t)) r.referral_fee += v;
    else r.other_fees += v;
  }
  for (const p of [...(it.PromotionList ?? []), ...(it.PromotionAdjustmentList ?? [])]) r.promotion += amt(p.PromotionAmount);
  for (const w of it.ItemTaxWithheldList ?? []) for (const c of w.TaxesWithheld ?? []) r.tax += amt(c.ChargeAmount);
  const total = r.principal + r.tax + r.shipping + r.promotion + r.fba_fee + r.referral_fee + r.other_fees;
  const key = it.OrderItemId ?? it.OrderAdjustmentItemId ?? String(idx);
  return {
    id: `${type}:${ev.AmazonOrderId ?? ""}:${ev.PostedDate ?? ""}:${it.SellerSKU ?? ""}:${key}`,
    event_type: type, posted_date: ev.PostedDate ?? new Date().toISOString(), order_id: ev.AmazonOrderId ?? null,
    sku: it.SellerSKU ?? null, quantity: it.QuantityShipped ?? null,
    principal: round(r.principal), tax: round(r.tax), shipping: round(r.shipping), promotion: round(r.promotion),
    fba_fee: round(r.fba_fee), referral_fee: round(r.referral_fee), other_fees: round(r.other_fees), total: round(total),
    description: null, raw: null,
  };
}

const empty = { principal: 0, tax: 0, shipping: 0, promotion: 0, fba_fee: 0, referral_fee: 0, other_fees: 0 };

/** Convierte la respuesta de listFinancialEvents en filas por SKU. */
export function parseFinancialEvents(fe: Record<string, unknown[]>, windowEnd: string): EventRow[] {
  const rows: EventRow[] = [];
  const shipLike: [string, string][] = [
    ["ShipmentEventList", "shipment"], ["RefundEventList", "refund"],
    ["GuaranteeClaimEventList", "refund"], ["ChargebackEventList", "refund"],
  ];
  for (const [list, type] of shipLike) {
    for (const ev of (fe[list] ?? []) as ShipEvent[]) {
      const items = ev.ShipmentItemList ?? ev.ShipmentItemAdjustmentList ?? [];
      items.forEach((it, i) => rows.push(itemRow(type, ev, it, i)));
    }
  }
  // Reembolsos de Amazon por inventario perdido/dañado y otros ajustes
  for (const ev of (fe.AdjustmentEventList ?? []) as { AdjustmentType?: string; PostedDate?: string; AdjustmentAmount?: Money;
    AdjustmentItemList?: { SellerSKU?: string; Quantity?: string; TotalAmount?: Money }[] }[]) {
    const posted = ev.PostedDate ?? windowEnd;
    if (ev.AdjustmentItemList?.length) {
      ev.AdjustmentItemList.forEach((it, i) => rows.push({
        ...empty, id: `adjustment:${posted}:${ev.AdjustmentType}:${it.SellerSKU ?? ""}:${i}:${hash(it)}`, event_type: "adjustment",
        posted_date: posted, order_id: null, sku: it.SellerSKU ?? null, quantity: Number(it.Quantity ?? 0) || null,
        other_fees: 0, total: round(amt(it.TotalAmount)), description: ev.AdjustmentType ?? null, raw: it,
      }));
    } else {
      rows.push({ ...empty, id: `adjustment:${posted}:${ev.AdjustmentType}:${hash(ev)}`, event_type: "adjustment", posted_date: posted,
        order_id: null, sku: null, quantity: null, total: round(amt(ev.AdjustmentAmount)), description: ev.AdjustmentType ?? null, raw: ev });
    }
  }
  // Cargos de servicio (suscripción, almacenamiento, etc.). Amazon no envía fecha: se usa el fin de la ventana.
  for (const ev of (fe.ServiceFeeEventList ?? []) as { FeeReason?: string; FeeDescription?: string; SellerSKU?: string; FeeList?: Fee[] }[]) {
    const total = (ev.FeeList ?? []).reduce((a, f) => a + amt(f.FeeAmount), 0);
    rows.push({ ...empty, id: `service_fee:${windowEnd}:${hash(ev)}`, event_type: "service_fee", posted_date: windowEnd, order_id: null,
      sku: ev.SellerSKU ?? null, quantity: null, other_fees: round(total), total: round(total),
      description: ev.FeeDescription ?? ev.FeeReason ?? (ev.FeeList ?? []).map((f) => f.FeeType).join(", "), raw: ev });
  }
  // Publicidad (Sponsored Products) cobrada desde el saldo de Amazon
  for (const ev of (fe.ProductAdsPaymentEventList ?? []) as { postedDate?: string; transactionType?: string; invoiceId?: string; transactionValue?: Money }[]) {
    const posted = ev.postedDate ?? windowEnd;
    rows.push({ ...empty, id: `ads:${ev.invoiceId ?? hash(ev)}:${posted}`, event_type: "service_fee", posted_date: posted, order_id: null,
      sku: null, quantity: null, other_fees: round(amt(ev.transactionValue)), total: round(amt(ev.transactionValue)),
      description: `Publicidad (${ev.transactionType ?? "Ads"})`, raw: ev });
  }
  // Cualquier otro tipo se guarda para revisión
  const handled = new Set(["ShipmentEventList", "RefundEventList", "GuaranteeClaimEventList", "ChargebackEventList",
    "AdjustmentEventList", "ServiceFeeEventList", "ProductAdsPaymentEventList"]);
  for (const [list, evs] of Object.entries(fe)) {
    if (handled.has(list) || !Array.isArray(evs)) continue;
    for (const ev of evs as Record<string, unknown>[]) {
      const posted = (ev.PostedDate as string) ?? (ev.postedDate as string) ?? windowEnd;
      rows.push({ ...empty, id: `other:${list}:${hash(ev)}`, event_type: "other", posted_date: posted, order_id: (ev.AmazonOrderId as string) ?? null,
        sku: null, quantity: null, total: 0, description: list, raw: ev });
    }
  }
  return rows;
}

type FinState = { window_start: string; next_token?: string | null; done_until?: string };

/**
 * Trae eventos financieros por ventanas de 90 días desde abr-2025, con límite de tiempo por ejecución.
 * Guarda el avance en amazon_sync_state para continuar en la siguiente ejecución.
 */
export async function syncFinances(supabase: SupabaseClient, budgetMs = 240_000) {
  const started = Date.now();
  const finish = await logRun(supabase, "finances");
  let saved = 0;
  try {
    const { data: st } = await supabase.from("amazon_sync_state").select("value").eq("key", "finances").maybeSingle();
    const state: FinState = (st?.value as FinState) ?? { window_start: HISTORY_START };
    // Margen de 2 horas: Amazon publica los eventos con algo de retraso
    const nowSafe = new Date(Date.now() - 2 * 3_600_000);
    let complete = false;

    while (Date.now() - started < budgetMs) {
      const start = new Date(state.window_start);
      // Al día: la próxima ejecución continúa desde donde quedó
      if (start >= nowSafe) { complete = true; break; }
      const end = new Date(Math.min(start.getTime() + WINDOW_DAYS * 86_400_000, nowSafe.getTime()));
      const res = await spGet<{ payload?: { FinancialEvents?: Record<string, unknown[]>; NextToken?: string } }>(
        "/finances/v0/financialEvents",
        state.next_token
          ? { NextToken: state.next_token, MaxResultsPerPage: "100" }
          : { PostedAfter: start.toISOString(), PostedBefore: end.toISOString(), MaxResultsPerPage: "100" },
      );
      const rows = parseFinancialEvents(res.payload?.FinancialEvents ?? {}, end.toISOString());
      if (rows.length) {
        // Asegura que cada SKU exista en amazon_listings para poder vincularlo
        const skus = [...new Set(rows.map((r) => r.sku).filter(Boolean))] as string[];
        if (skus.length) await supabase.from("amazon_listings").upsert(skus.map((sku) => ({ sku })), { onConflict: "sku", ignoreDuplicates: true });
        const { error } = await supabase.from("amazon_financial_events").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        saved += rows.length;
      }
      if (res.payload?.NextToken) {
        state.next_token = res.payload.NextToken;
      } else {
        state.next_token = null;
        state.done_until = end.toISOString();
        state.window_start = end.toISOString();
      }
      await supabase.from("amazon_sync_state").upsert({ key: "finances", value: state, updated_at: new Date().toISOString() });
      await sleep(2100); // límite de Amazon: 0.5 solicitudes por segundo
    }

    if (complete) await autoLinkListings(supabase);
    const msg = complete
      ? `Ventas y finanzas al día (${saved} registros nuevos o revisados)`
      : `Avance guardado hasta ${state.window_start.slice(0, 10)} (${saved} registros). Vuelve a sincronizar para continuar.`;
    await finish(complete ? "ok" : "partial", saved, msg);
    return { ok: true, complete, message: msg };
  } catch (e) {
    const msg = e instanceof SpApiError || e instanceof Error ? e.message : String(e);
    await finish("error", saved, msg);
    return { ok: false, complete: false, message: msg };
  }
}
