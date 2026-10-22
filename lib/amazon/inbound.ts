import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MARKETPLACE_ID, spGet } from "@/lib/amazon/spapi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STATUSES = ["WORKING", "READY_TO_SHIP", "SHIPPED", "RECEIVING", "CANCELLED", "DELETED", "CLOSED", "ERROR", "IN_TRANSIT", "DELIVERED", "CHECKED_IN"];

/** Estado de Amazon → estado del envío en la app. */
export const AMAZON_TO_APP_STATUS: Record<string, string> = {
  WORKING: "working", READY_TO_SHIP: "working", SHIPPED: "shipped", IN_TRANSIT: "in_transit",
  DELIVERED: "delivered", CHECKED_IN: "delivered", RECEIVING: "receiving", CLOSED: "closed",
  CANCELLED: "cancelled", DELETED: "cancelled", ERROR: "cancelled",
};

type ShipmentData = { ShipmentId: string; ShipmentName?: string; DestinationFulfillmentCenterId?: string; ShipmentStatus: string };
type ItemData = { SellerSKU: string; QuantityShipped?: number; QuantityReceived?: number };
export type InboundItem = { sku: string; shipped: number; received: number };

/** Amazon no da fecha en el envío; el nombre de Send to Amazon suele traerla: "FBA STA (10/09/2025 14:12)-XXX". */
function dateFromName(name?: string) {
  const m = name?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** Trae los envíos a Amazon (desde 2025) y sus unidades enviadas y recibidas. */
export async function syncInbound(supabase: SupabaseClient) {
  const found = new Map<string, ShipmentData>();
  const nowSafe = Date.now() - 5 * 60_000;
  for (let start = Date.parse("2025-01-01T00:00:00Z"); start < nowSafe; start += 90 * 86_400_000) {
    const end = Math.min(start + 90 * 86_400_000, nowSafe);
    let next: string | undefined;
    do {
      const res = await spGet<{ payload?: { ShipmentData?: ShipmentData[]; NextToken?: string } }>("/fba/inbound/v0/shipments", next
        ? { QueryType: "NEXT_TOKEN", NextToken: next, MarketplaceId: MARKETPLACE_ID }
        : { QueryType: "DATE_RANGE", ShipmentStatusList: STATUSES.join(","), LastUpdatedAfter: new Date(start).toISOString(),
            LastUpdatedBefore: new Date(end).toISOString(), MarketplaceId: MARKETPLACE_ID });
      for (const s of res.payload?.ShipmentData ?? []) found.set(s.ShipmentId, s);
      next = res.payload?.NextToken;
      await sleep(600);
    } while (next);
  }

  // Los envíos cerrados ya guardados con sus unidades no cambian: no se vuelven a pedir
  const { data: known } = await supabase.from("amazon_inbound_shipments").select("shipment_id, status, items");
  const done = new Set((known ?? []).filter((k) => k.status === "CLOSED" && (k.items as InboundItem[]).length).map((k) => k.shipment_id));

  const rows = [];
  for (const s of found.values()) {
    if (done.has(s.ShipmentId) && s.ShipmentStatus === "CLOSED") continue;
    const items: InboundItem[] = [];
    let next: string | undefined;
    do {
      const res = await spGet<{ payload?: { ItemData?: ItemData[]; NextToken?: string } }>(
        `/fba/inbound/v0/shipments/${encodeURIComponent(s.ShipmentId)}/items`,
        next ? { MarketplaceId: MARKETPLACE_ID, NextToken: next } : { MarketplaceId: MARKETPLACE_ID },
      );
      for (const i of res.payload?.ItemData ?? []) items.push({ sku: i.SellerSKU, shipped: i.QuantityShipped ?? 0, received: i.QuantityReceived ?? 0 });
      next = res.payload?.NextToken;
      await sleep(600);
    } while (next);
    rows.push({ shipment_id: s.ShipmentId, name: s.ShipmentName ?? null, destination_fc: s.DestinationFulfillmentCenterId ?? null,
      status: s.ShipmentStatus, shipped_on: dateFromName(s.ShipmentName), items, synced_at: new Date().toISOString() });
  }
  if (rows.length) {
    const { error } = await supabase.from("amazon_inbound_shipments").upsert(rows, { onConflict: "shipment_id" });
    if (error) throw new Error(error.message);
  }
  return { total: found.size, updated: rows.length };
}
