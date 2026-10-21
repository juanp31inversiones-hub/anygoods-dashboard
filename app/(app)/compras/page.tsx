import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS, date, money, units } from "@/lib/format";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

type Line = { units: number; unit_cost: number; landed_unit_cost: number | null; products: { description: string; asin: string | null } | null };
type PO = {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  arrival_date: string | null;
  status: string;
  supplier_shipping: number;
  amazon_shipping: number;
  amazon_placement_fee: number;
  notes: string | null;
  supplier: { name: string } | null;
  paid_via: { name: string } | null;
  purchase_order_lines: Line[];
};

export default async function Compras() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select(
      "id, invoice_number, purchase_date, arrival_date, status, supplier_shipping, amazon_shipping, amazon_placement_fee, notes, supplier:counterparties!purchase_orders_supplier_id_fkey(name), paid_via:counterparties!purchase_orders_paid_via_id_fkey(name), purchase_order_lines(units, unit_cost, landed_unit_cost, products(description, asin))",
    )
    .order("purchase_date", { ascending: false })
    .returns<PO[]>();

  const pos = data ?? [];
  const productCost = (po: PO) => po.purchase_order_lines.reduce((a, l) => a + l.units * Number(l.unit_cost), 0);
  const logistics = (po: PO) => Number(po.supplier_shipping) + Number(po.amazon_shipping) + Number(po.amazon_placement_fee);
  const totalProduct = pos.reduce((a, p) => a + productCost(p), 0);
  const totalLogistics = pos.reduce((a, p) => a + logistics(p), 0);

  const bySupplier = Object.entries(
    pos.reduce<Record<string, number>>((acc, p) => {
      const k = p.supplier?.name ?? "—";
      acc[k] = (acc[k] ?? 0) + productCost(p) + logistics(p);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        subtitle={`${pos.length} órdenes · producto ${money(totalProduct)} · logística ${money(totalLogistics)} · total ${money(totalProduct + totalLogistics)}`}
        action={{ href: "/compras/nueva", label: "Nueva orden" }}
      />

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Por proveedor</h2>
        <table className="data mt-2">
          <thead><tr><th>Proveedor</th><th className="num">Total con logística</th><th className="num">% del total</th></tr></thead>
          <tbody>
            {bySupplier.map(([name, total]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{money(total)}</td>
                <td className="num">{((total / (totalProduct + totalLogistics)) * 100).toFixed(1)}%</td>
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
              <span className="ml-auto tabular-nums font-medium">{money(productCost(po) + logistics(po))}</span>
            </summary>
            <div className="overflow-x-auto border-t" style={{ borderColor: "var(--border)" }}>
              <table className="data">
                <thead>
                  <tr><th>Producto</th><th>ASIN</th><th className="num">Unidades</th><th className="num">Costo und</th><th className="num">Costo final und</th><th className="num">Subtotal</th></tr>
                </thead>
                <tbody>
                  {po.purchase_order_lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.products?.description}</td>
                      <td className="muted">{l.products?.asin ?? "—"}</td>
                      <td className="num">{units(l.units)}</td>
                      <td className="num">{money(l.unit_cost)}</td>
                      <td className="num">{money(l.landed_unit_cost ?? l.unit_cost)}</td>
                      <td className="num">{money(l.units * Number(l.unit_cost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted text-xs px-4 py-3">
                Transporte proveedor {money(po.supplier_shipping)} · Envío Amazon {money(po.amazon_shipping)} · Placement{" "}
                {money(po.amazon_placement_fee)}
                {po.notes && <><br />{po.notes}</>}
              </p>
              <div className="px-4 pb-4"><Link href={`/compras/${po.id}`} className="btn-ghost text-xs">Editar orden</Link></div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
