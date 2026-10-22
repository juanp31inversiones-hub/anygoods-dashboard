import type { SupabaseClient } from "@supabase/supabase-js";
import type { FbaShipmentPayload } from "@/lib/actions";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Lee un envío de la app en el formato que usan el editor y saveFbaShipment. */
export async function loadShipmentPayload(supabase: SupabaseClient, id: string): Promise<FbaShipmentPayload | null> {
  const { data: sh } = await supabase.from("fba_shipments")
    .select("*, fba_shipment_items(id, product_id, qty_shipped, qty_received), fba_shipment_costs(id, cost_type, description, amount, charged_to, allocation)")
    .eq("id", id).single();
  if (!sh) return null;
  return {
    id: sh.id,
    shipment_id: s(sh.shipment_id), name: s(sh.name), destination_fc: s(sh.destination_fc), from_location: sh.from_location,
    status: sh.status, created_on: s(sh.created_on), shipped_on: s(sh.shipped_on), closed_on: s(sh.closed_on),
    carrier: s(sh.carrier), tracking: s(sh.tracking), boxes: s(sh.boxes), weight_lb: s(sh.weight_lb), notes: s(sh.notes),
    items: (sh.fba_shipment_items as { id: string; product_id: string; qty_shipped: number; qty_received: number | null }[]).map((i) => ({
      id: i.id, product_id: i.product_id, qty_shipped: s(i.qty_shipped), qty_received: s(i.qty_received),
    })),
    costs: (sh.fba_shipment_costs as { id: string; cost_type: string; description: string | null; amount: number; charged_to: string; allocation: "units" | "value" }[]).map((c) => ({
      id: c.id, cost_type: c.cost_type, description: s(c.description), amount: s(c.amount), charged_to: c.charged_to, allocation: c.allocation,
    })),
  };
}
