import type { SupabaseClient } from "@supabase/supabase-js";

/** Stock por producto y ubicación, calculado desde los movimientos de inventario. */
export async function stockByLocation(supabase: SupabaseClient, onlyActive = true, excludeShipment?: string) {
  const [{ data: allMoves }, { data: products }] = await Promise.all([
    supabase.from("inventory_movements").select("product_id, location, qty, fba_shipment_id"),
    supabase.from("v_inventory_on_hand").select("product_id, description, asin, image_url, avg_cost, retail_price, active, units_on_hand, inventory_value, inbound_unit_cost, fba_unit_cost"),
  ]);
  // Al editar un envío, su propio movimiento no cuenta para el stock disponible
  const moves = (allMoves ?? []).filter((m) => !excludeShipment || m.fba_shipment_id !== excludeShipment);
  const stock = new Map<string, Record<string, number>>();
  for (const m of moves) {
    const s = stock.get(m.product_id) ?? {};
    s[m.location] = (s[m.location] ?? 0) + m.qty;
    stock.set(m.product_id, s);
  }
  return (products ?? [])
    .filter((p) => !onlyActive || p.active)
    .map((p) => ({ ...p, stock: stock.get(p.product_id) ?? {} }))
    .sort((a, b) => a.description.localeCompare(b.description));
}
