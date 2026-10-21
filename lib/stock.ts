import type { SupabaseClient } from "@supabase/supabase-js";

/** Stock por producto y ubicación, calculado desde los movimientos de inventario. */
export async function stockByLocation(supabase: SupabaseClient, onlyActive = true) {
  const [{ data: moves }, { data: products }] = await Promise.all([
    supabase.from("inventory_movements").select("product_id, location, qty"),
    supabase.from("v_inventory_on_hand").select("product_id, description, asin, image_url, avg_cost, retail_price, active, units_on_hand, inventory_value"),
  ]);
  const stock = new Map<string, Record<string, number>>();
  for (const m of moves ?? []) {
    const s = stock.get(m.product_id) ?? {};
    s[m.location] = (s[m.location] ?? 0) + m.qty;
    stock.set(m.product_id, s);
  }
  return (products ?? [])
    .filter((p) => !onlyActive || p.active)
    .map((p) => ({ ...p, stock: stock.get(p.product_id) ?? {} }))
    .sort((a, b) => a.description.localeCompare(b.description));
}
