import type { SupabaseClient } from "@supabase/supabase-js";

export async function formOptions(supabase: SupabaseClient) {
  const [cps, products, partners, accounts, pos, cats] = await Promise.all([
    supabase.from("counterparties").select("id, name, kind").order("name"),
    supabase.from("products").select("id, description, units_per_case, active").order("description"),
    supabase.from("partners").select("id, short_name").order("short_name"),
    supabase.from("bank_accounts").select("id, name").order("name"),
    supabase.from("purchase_orders").select("id, po_number, invoice_number, purchase_date, supplier_id, counterparties!purchase_orders_supplier_id_fkey(name)").order("purchase_date", { ascending: false }),
    supabase.from("txn_categories").select("key, label, direction").order("label"),
  ]);
  return {
    counterparties: cps.data ?? [],
    products: products.data ?? [],
    partners: partners.data ?? [],
    accounts: accounts.data ?? [],
    purchaseOrders: ((pos.data ?? []) as unknown as { id: string; po_number: string | null; invoice_number: string | null; purchase_date: string; supplier_id: string | null; counterparties: { name: string } | null }[])
      .map((p) => ({ id: p.id, supplier_id: p.supplier_id, name: `${p.po_number ?? p.invoice_number ?? "Sin PO"} · ${p.counterparties?.name ?? ""} · ${p.purchase_date}` })),
    customCategories: (cats.data ?? []) as { key: string; label: string; direction: "in" | "out" }[],
  };
}
