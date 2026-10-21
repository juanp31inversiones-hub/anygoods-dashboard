import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { KindSelect } from "@/components/KindSelect";
import { money } from "@/lib/format";

const TABS = [
  { key: "supplier", label: "Proveedores", kinds: ["supplier"] },
  { key: "brand", label: "Marcas", kinds: ["brand"] },
  { key: "service", label: "Servicios y herramientas", kinds: ["service"] },
  { key: "marketplace", label: "Marketplaces", kinds: ["marketplace"] },
  { key: "other", label: "Otros", kinds: ["partner", "other"] },
  { key: "all", label: "Todos", kinds: [] as string[] },
];

export default async function Proveedores({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "supplier" } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const supabase = await createClient();
  const [{ data: cps }, { data: pos }, { data: txns }] = await Promise.all([
    supabase.from("counterparties").select("id, name, kind, contact_name, email").order("name"),
    supabase.from("purchase_orders").select("supplier_id, purchase_date, purchase_order_lines(units, unit_cost)"),
    supabase.from("bank_transactions").select("counterparty_id, amount"),
  ]);

  const bought = new Map<string, { total: number; count: number; last: string }>();
  for (const po of pos ?? []) {
    const v = (po.purchase_order_lines as { units: number; unit_cost: number }[]).reduce((a, l) => a + l.units * Number(l.unit_cost), 0);
    const b = bought.get(po.supplier_id) ?? { total: 0, count: 0, last: "" };
    bought.set(po.supplier_id, { total: b.total + v, count: b.count + 1, last: po.purchase_date > b.last ? po.purchase_date : b.last });
  }
  const paid = new Map<string, number>();
  for (const t of txns ?? []) if (t.counterparty_id) paid.set(t.counterparty_id, (paid.get(t.counterparty_id) ?? 0) + Number(t.amount));

  const all = cps ?? [];
  const count = (kinds: string[]) => (kinds.length ? all.filter((c) => kinds.includes(c.kind)).length : all.length);
  const rows = current.kinds.length ? all.filter((c) => current.kinds.includes(c.kind)) : all;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores y contrapartes"
        subtitle="Cambia el tipo de cada uno desde la tabla. En las compras solo aparecen Proveedores y Marcas."
        action={{ href: "/proveedores/nuevo", label: "Nuevo", icon: Plus }}
      />

      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/proveedores?tab=${t.key}`} className="px-4 py-2 text-sm -mb-px border-b-2 whitespace-nowrap"
            style={t.key === current.key ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "transparent", color: "var(--muted)" }}>
            {t.label} <span className="muted">({count(t.kinds)})</span>
          </Link>
        ))}
      </div>

      <section className="card overflow-x-auto">
        <table className="data min-w-[760px]">
          <thead>
            <tr><th>Nombre</th><th>Tipo</th><th>Contacto</th><th className="num">Compras</th><th className="num">Total comprado</th><th className="num">Neto en banco</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const b = bought.get(c.id);
              return (
                <tr key={c.id}>
                  <td><Link href={`/proveedores/${c.id}`} className="link font-medium">{c.name}</Link></td>
                  <td><KindSelect id={c.id} kind={c.kind} /></td>
                  <td className="muted">{[c.contact_name, c.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num">{b ? b.count : "—"}</td>
                  <td className="num">{b ? money(b.total) : "—"}</td>
                  <td className={`num ${(paid.get(c.id) ?? 0) < 0 ? "neg" : ""}`}>{paid.has(c.id) ? money(paid.get(c.id)) : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No hay registros en esta categoría.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
