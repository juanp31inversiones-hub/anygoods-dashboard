import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackLink, PageHeader } from "@/components/ui";
import { COST_TYPE_LABELS, date, money } from "@/lib/format";

type Row = {
  id: string;
  cost_type: string;
  description: string | null;
  amount: number;
  allocation: string;
  cost_date: string | null;
  products: { description: string } | null;
  counterparties: { name: string } | null;
  purchase_orders: { id: string; invoice_number: string | null; supplier: { name: string } | null } | null;
};

export default async function Costos({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("additional_costs")
    .select("id, cost_type, description, amount, allocation, cost_date, products(description), counterparties(name), purchase_orders(id, invoice_number, supplier:counterparties!purchase_orders_supplier_id_fkey(name))")
    .is("moved_to_shipment_id", null)
    .order("cost_date", { ascending: false });
  if (type) q = q.eq("cost_type", type);
  const { data } = await q.returns<Row[]>();
  const rows = data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <BackLink href="/compras" label="Compras" />
      <PageHeader
        title="Costos adicionales"
        subtitle={`${rows.length} costos · ${money(total)}. Se suman al costo del producto para obtener su costo neto.`}
        action={{ href: "/compras/costos/nuevo", label: "Agregar costo", icon: Plus }}
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/compras/costos" className="rounded-full px-3 py-1 border" style={{ borderColor: "var(--border)", fontWeight: type ? 400 : 600 }}>Todos</Link>
        {Object.entries(COST_TYPE_LABELS).map(([k, v]) => (
          <Link key={k} href={`/compras/costos?type=${k}`} className="rounded-full px-3 py-1 border" style={{ borderColor: "var(--border)", fontWeight: type === k ? 600 : 400 }}>{v}</Link>
        ))}
      </div>
      <section className="card overflow-x-auto">
        <table className="data min-w-[860px]">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Orden</th><th>Aplica a</th><th>Descripción</th><th>Pagado a</th><th className="num">Monto</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{date(r.cost_date)}</td>
                <td>{COST_TYPE_LABELS[r.cost_type] ?? r.cost_type}</td>
                <td>
                  <Link href={`/compras/${r.purchase_orders?.id}`} className="link">
                    {r.purchase_orders?.supplier?.name} · {r.purchase_orders?.invoice_number ?? "s/n"}
                  </Link>
                </td>
                <td>{r.products?.description ?? <span className="muted">Toda la orden ({r.allocation === "value" ? "por valor" : "por unidades"})</span>}</td>
                <td className="muted">{r.description}</td>
                <td>{r.counterparties?.name ?? "—"}</td>
                <td className={`num ${Number(r.amount) < 0 ? "pos" : ""}`}>{money(r.amount)}</td>
                <td><Link href={`/compras/costos/${r.id}`} aria-label="Editar" className="muted"><Pencil size={14} /></Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Sin costos.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
