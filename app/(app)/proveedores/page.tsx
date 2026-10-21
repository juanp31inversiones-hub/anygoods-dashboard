import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { Plus } from "lucide-react";
import { KIND_LABELS, money } from "@/lib/format";

export default async function Proveedores() {
  const supabase = await createClient();
  const [{ data: cps }, { data: pos }, { data: txns }] = await Promise.all([
    supabase.from("counterparties").select("id, name, kind, contact_name, email").order("name"),
    supabase.from("purchase_orders").select("supplier_id, purchase_order_lines(units, unit_cost)"),
    supabase.from("bank_transactions").select("counterparty_id, amount"),
  ]);

  const bought = new Map<string, number>();
  for (const po of pos ?? []) {
    const v = (po.purchase_order_lines as { units: number; unit_cost: number }[]).reduce((a, l) => a + l.units * Number(l.unit_cost), 0);
    bought.set(po.supplier_id, (bought.get(po.supplier_id) ?? 0) + v);
  }
  const paid = new Map<string, number>();
  for (const t of txns ?? []) if (t.counterparty_id) paid.set(t.counterparty_id, (paid.get(t.counterparty_id) ?? 0) + Number(t.amount));

  return (
    <div className="space-y-6">
      <PageHeader title="Proveedores y contrapartes" subtitle="Proveedores, marcas, marketplaces y servicios" action={{ href: "/proveedores/nuevo", label: "Nuevo proveedor", icon: Plus }} />
      <section className="card overflow-x-auto">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Contacto</th><th className="num">Compras registradas</th><th className="num">Neto en banco</th></tr></thead>
          <tbody>
            {(cps ?? []).map((c) => (
              <tr key={c.id}>
                <td><Link href={`/proveedores/${c.id}`} className="link font-medium">{c.name}</Link></td>
                <td>{KIND_LABELS[c.kind] ?? c.kind}</td>
                <td className="muted">{[c.contact_name, c.email].filter(Boolean).join(" · ") || "—"}</td>
                <td className="num">{bought.has(c.id) ? money(bought.get(c.id)) : "—"}</td>
                <td className={`num ${(paid.get(c.id) ?? 0) < 0 ? "neg" : ""}`}>{paid.has(c.id) ? money(paid.get(c.id)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
