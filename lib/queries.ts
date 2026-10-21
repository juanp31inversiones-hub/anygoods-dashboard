import type { SupabaseClient } from "@supabase/supabase-js";

export async function formOptions(supabase: SupabaseClient) {
  const [cps, products, partners, accounts, pos] = await Promise.all([
    supabase.from("counterparties").select("id, name, kind").order("name"),
    supabase.from("products").select("id, description, units_per_case, active").order("description"),
    supabase.from("partners").select("id, short_name").order("short_name"),
    supabase.from("bank_accounts").select("id, name").order("name"),
    supabase.from("purchase_orders").select("id, invoice_number, purchase_date, counterparties!purchase_orders_supplier_id_fkey(name)").order("purchase_date", { ascending: false }),
  ]);
  return {
    counterparties: cps.data ?? [],
    products: products.data ?? [],
    partners: partners.data ?? [],
    accounts: accounts.data ?? [],
    purchaseOrders: ((pos.data ?? []) as unknown as { id: string; invoice_number: string | null; purchase_date: string; counterparties: { name: string } | null }[])
      .map((p) => ({ id: p.id, name: `${p.counterparties?.name ?? ""} · ${p.invoice_number ?? "s/f"} · ${p.purchase_date}` })),
  };
}
