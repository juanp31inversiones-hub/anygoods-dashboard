import Link from "next/link";
import { CheckCircle2, Circle, Pencil, Plus, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { COST_TYPES, COST_TYPE_LABELS, STATUS_LABELS, date, money, units } from "@/lib/format";

type Line = { id: string; units: number; unit_cost: number; landed_unit_cost: number | null; products: { id: string; description: string; asin: string | null } | null };
type Cost = { cost_type: string; amount: number; description: string | null; products: { description: string } | null };
type PO = {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  status: string;
  notes: string | null;
  supplier: { name: string } | null;
  paid_via: { name: string } | null;
  purchase_order_lines: Line[];
  additional_costs: Cost[];
  po_documents: { doc_type: string }[];
};

export default async function Compras() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select(
      "id, invoice_number, purchase_date, status, notes, supplier:counterparties!purchase_orders_supplier_id_fkey(name), paid_via:counterparties!purchase_orders_paid_via_id_fkey(name), purchase_order_lines(id, units, unit_cost, landed_unit_cost, products(id, description, asin)), additional_costs(cost_type, amount, description, products(description)), po_documents(doc_type)",
    )
    .order("purchase_date", { ascending: false })
    .returns<PO[]>();

  const pos = data ?? [];
  const net = (po: PO) => po.purchase_order_lines.reduce((a, l) => a + l.units * Number(l.unit_cost), 0);
  const extra = (po: PO) => po.additional_costs.reduce((a, c) => a + Number(c.amount), 0);
  const totalNet = pos.reduce((a, p) => a + net(p), 0);
  const byType = new Map<string, number>();
  for (const p of pos) for (const c of p.additional_costs) byType.set(c.cost_type, (byType.get(c.cost_type) ?? 0) + Number(c.amount));
  const totalExtra = [...byType.values()].reduce((a, v) => a + v, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        subtitle={`${pos.length} órdenes`}
        actions={[
          { href: "/compras/nueva", label: "Nueva orden", icon: Plus },
          { href: "/compras/costos", label: "Costos adicionales", icon: Receipt },
        ]}
      />

      <section className="grid lg:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="muted text-xs uppercase tracking-wide">Compras netas a proveedores</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{money(totalNet)}</div>
        </div>
        <div className="card p-4">
          <div className="muted text-xs uppercase tracking-wide">+ Costos adicionales</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{money(totalExtra)}</div>
          <div className="muted text-xs mt-1">{totalNet ? `${((totalExtra / totalNet) * 100).toFixed(1)}% sobre la compra neta` : ""}</div>
        </div>
        <div className="card p-4">
          <div className="muted text-xs uppercase tracking-wide">= Costo total de la mercancía</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{money(totalNet + totalExtra)}</div>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Costos adicionales por tipo</h2>
        <table className="data mt-2">
          <thead><tr><th>Tipo</th><th className="num">Total</th><th className="num">% sobre compra neta</th></tr></thead>
          <tbody>
            {COST_TYPES.filter((t) => byType.has(t)).map((t) => (
              <tr key={t}>
                <td>{COST_TYPE_LABELS[t]}</td>
                <td className="num">{money(byType.get(t))}</td>
                <td className="num">{totalNet ? `${(((byType.get(t) ?? 0) / totalNet) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="space-y-3">
        {pos.map((po) => (
          <details key={po.id} className="card">
            <summary className="cursor-pointer px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 items-baseline">
              <span className="font-medium">{po.supplier?.name}</span>
              <span className="muted text-sm">Factura {po.invoice_number ?? "—"}</span>
              <span className="muted text-sm">{date(po.purchase_date)}</span>
              <span className="text-xs rounded px-2 py-0.5" style={{ background: "var(--bg)" }}>{STATUS_LABELS[po.status] ?? po.status}</span>
              {po.paid_via && <span className="text-xs muted">Pagada vía {po.paid_via.name}</span>}
              <span className="flex gap-2 text-xs muted">
                {[["our_po", "PO"], ["supplier_invoice", "Invoice"], ["payment_proof", "Pago"]].map(([t, l]) => {
                  const has = po.po_documents.some((d) => d.doc_type === t);
                  return (
                    <span key={t} className="inline-flex items-center gap-1" title={has ? `${l} adjunto` : `Falta ${l}`}>
                      {has ? <CheckCircle2 size={13} className="pos" /> : <Circle size={13} />} {l}
                    </span>
                  );
                })}
              </span>
              <span className="ml-auto tabular-nums text-sm">
                <span className="muted">{money(net(po))} + {money(extra(po))} = </span>
                <span className="font-semibold">{money(net(po) + extra(po))}</span>
              </span>
            </summary>
            <div className="overflow-x-auto border-t" style={{ borderColor: "var(--border)" }}>
              <table className="data">
                <thead>
                  <tr><th>Producto</th><th className="num">Unidades</th><th className="num">Costo proveedor/u</th><th className="num">Costos adic./u</th><th className="num">Costo neto/u</th><th className="num">Total neto</th></tr>
                </thead>
                <tbody>
                  {po.purchase_order_lines.map((l) => {
                    const landed = Number(l.landed_unit_cost ?? l.unit_cost);
                    return (
                      <tr key={l.id}>
                        <td><Link href={`/productos/${l.products?.id}`} className="link">{l.products?.description}</Link></td>
                        <td className="num">{units(l.units)}</td>
                        <td className="num">{money(l.unit_cost)}</td>
                        <td className="num muted">{money(landed - Number(l.unit_cost))}</td>
                        <td className="num font-medium">{money(landed)}</td>
                        <td className="num">{money(landed * l.units)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {po.additional_costs.length > 0 && (
                <div className="px-4 py-3 text-xs space-y-1">
                  <div className="font-medium">Costos adicionales</div>
                  {po.additional_costs.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="muted w-48 shrink-0">{COST_TYPE_LABELS[c.cost_type] ?? c.cost_type}</span>
                      <span className="flex-1 muted">{c.products?.description ?? "Toda la orden"}{c.description ? ` · ${c.description}` : ""}</span>
                      <span className="tabular-nums">{money(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {po.notes && <p className="muted text-xs px-4 pb-2">{po.notes}</p>}
              <div className="px-4 pb-4 flex gap-2">
                <Link href={`/compras/${po.id}`} className="btn-ghost text-xs"><Pencil size={14} /> Editar, costos y documentos</Link>
                <Link href={`/compras/costos/nuevo?po=${po.id}`} className="btn-ghost text-xs"><Plus size={14} /> Agregar costo</Link>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
