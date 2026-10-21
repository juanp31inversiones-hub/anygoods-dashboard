import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/lib/format";

/** Opciones para el formulario de costos: órdenes con sus productos, contrapartes y egresos bancarios. */
export async function costFormOptions(supabase: SupabaseClient) {
  const [pos, cps, txns] = await Promise.all([
    supabase.from("purchase_orders")
      .select("id, invoice_number, purchase_date, supplier:counterparties!purchase_orders_supplier_id_fkey(name), purchase_order_lines(products(id, description))")
      .order("purchase_date", { ascending: false }),
    supabase.from("counterparties").select("id, name").order("name"),
    supabase.from("bank_transactions").select("id, txn_date, description, amount").lt("amount", 0).order("txn_date", { ascending: false }).limit(300),
  ]);
  type P = { id: string; invoice_number: string | null; purchase_date: string; supplier: { name: string } | null; purchase_order_lines: { products: { id: string; description: string } | null }[] };
  return {
    purchaseOrders: ((pos.data ?? []) as unknown as P[]).map((p) => ({
      id: p.id,
      name: `${p.purchase_date} · ${p.supplier?.name ?? ""} · Factura ${p.invoice_number ?? "s/n"}`,
      products: p.purchase_order_lines.map((l) => l.products).filter(Boolean) as { id: string; description: string }[],
    })),
    counterparties: cps.data ?? [],
    transactions: (txns.data ?? []).map((t) => ({ id: t.id, name: `${t.txn_date} · ${t.description} · ${money(t.amount)}` })),
  };
}
