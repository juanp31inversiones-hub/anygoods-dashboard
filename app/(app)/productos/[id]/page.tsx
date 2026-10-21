import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, type Product } from "@/components/ProductForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { PackageMinus, Send } from "lucide-react";
import { deleteProduct } from "@/lib/actions";
import { COST_TYPES, COST_TYPE_LABELS, LOCATION_LABELS, MOVEMENT_LABELS, date, money, units } from "@/lib/format";
import { Plus } from "lucide-react";

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: product }, { data: stock }, { data: lines }, { data: moves }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).single<Product>(),
    supabase.from("v_inventory_on_hand").select("*").eq("product_id", id).single(),
    supabase.from("purchase_order_lines")
      .select("id, units, unit_cost, landed_unit_cost, purchase_orders(id, invoice_number, purchase_date, counterparties!purchase_orders_supplier_id_fkey(name))")
      .eq("product_id", id),
    supabase.from("inventory_movements").select("id, movement, qty, location, occurred_on, reference, notes").eq("product_id", id).order("occurred_on", { ascending: false }),
  ]);
  if (!product) notFound();
  const lineIds = (lines ?? []).map((l) => l.id as string);
  const { data: costs } = lineIds.length
    ? await supabase.from("v_line_costs").select("line_id, cost_type, amount").in("line_id", lineIds)
    : { data: [] };

  type L = { id: string; units: number; unit_cost: number; landed_unit_cost: number | null; purchase_orders: { id: string; invoice_number: string | null; purchase_date: string; counterparties: { name: string } | null } | null };

  return (
    <div className="space-y-6 max-w-4xl">
      <BackLink href="/productos" label="Productos" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{product.description}</h1>
        <div className="flex flex-wrap gap-2 items-start">
          {Number(stock?.units_on_hand ?? 0) !== 0 && (
            <>
              <Link href={`/inventario/envio?product=${id}`} className="btn-primary"><Send size={16} /> Enviar a Amazon</Link>
              <Link href={`/inventario/conteo?product=${id}`} className="btn-ghost"><PackageMinus size={16} /> Dar salida</Link>
            </>
          )}
          <DeleteButton action={deleteProduct.bind(null, id)} confirmText="¿Eliminar este producto? Si tiene compras asociadas, desactívalo en su lugar." />
        </div>
      </div>

      {stock && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3"><div className="muted text-xs">En FBA</div><div className="text-lg font-semibold">{units(stock.units_fba)}</div></div>
          <div className="card p-3"><div className="muted text-xs">En mi inventario y otros</div><div className="text-lg font-semibold">{units(stock.units_other)}</div></div>
          <div className="card p-3"><div className="muted text-xs">Costo promedio</div><div className="text-lg font-semibold">{money(stock.avg_cost)}</div></div>
          <div className="card p-3"><div className="muted text-xs">Valor a costo</div><div className="text-lg font-semibold">{money(stock.inventory_value)}</div></div>
        </div>
      )}

      <ProductForm product={product} />

      <CostBreakdown lines={(lines ?? []) as unknown as L[]} costs={costs ?? []} productId={id} />

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold">Movimientos de inventario</h2>
          <Link href={`/inventario/movimiento?product=${id}`} className="link text-sm">Registrar movimiento</Link>
        </div>
        <table className="data mt-2">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Ubicación</th><th>Referencia</th><th className="num">Cantidad</th></tr></thead>
          <tbody>
            {(moves ?? []).map((m) => (
              <tr key={m.id}>
                <td>{date(m.occurred_on)}</td>
                <td>{MOVEMENT_LABELS[m.movement] ?? m.movement}</td>
                <td>{LOCATION_LABELS[m.location] ?? m.location}</td>
                <td className="muted">{m.reference}{m.notes ? ` · ${m.notes}` : ""}</td>
                <td className={`num ${m.qty < 0 ? "neg" : "pos"}`}>{m.qty > 0 ? "+" : ""}{units(m.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

type BLine = { id: string; units: number; unit_cost: number; landed_unit_cost: number | null; purchase_orders: { id: string; invoice_number: string | null; purchase_date: string; counterparties: { name: string } | null } | null };

/** Costo neto por unidad = costo proveedor + cada costo adicional, por compra y promedio ponderado. */
function CostBreakdown({ lines, costs, productId }: { lines: BLine[]; costs: { line_id: string; cost_type: string; amount: number }[]; productId: string }) {
  const perLine = new Map<string, Record<string, number>>();
  for (const c of costs) {
    const m = perLine.get(c.line_id) ?? {};
    m[c.cost_type] = (m[c.cost_type] ?? 0) + Number(c.amount);
    perLine.set(c.line_id, m);
  }
  const types = COST_TYPES.filter((t) => costs.some((c) => c.cost_type === t));
  const totalUnits = lines.reduce((a, l) => a + l.units, 0);
  const avg = (f: (l: BLine) => number) => (totalUnits ? lines.reduce((a, l) => a + f(l), 0) / totalUnits : 0);
  const sorted = lines.slice().sort((a, b) => (b.purchase_orders?.purchase_date ?? "").localeCompare(a.purchase_orders?.purchase_date ?? ""));

  return (
    <section className="card overflow-x-auto">
      <div className="px-4 pt-4">
        <h2 className="font-semibold">Costo neto por unidad</h2>
        <p className="muted text-xs">Costo del proveedor + costos adicionales repartidos = costo neto. Para agregar o corregir un costo, usa el botón de cada compra.</p>
      </div>
      <table className="data mt-2 min-w-[760px]">
        <thead>
          <tr>
            <th>Compra</th><th className="num">Unidades</th><th className="num">Proveedor/u</th>
            {types.map((t) => <th key={t} className="num">{COST_TYPE_LABELS[t]}/u</th>)}
            <th className="num">Costo neto/u</th><th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const m = perLine.get(l.id) ?? {};
            return (
              <tr key={l.id}>
                <td>
                  <Link className="link" href={`/compras/${l.purchase_orders?.id}`}>{l.purchase_orders?.counterparties?.name} · {l.purchase_orders?.invoice_number ?? "s/n"}</Link>
                  <div className="muted text-xs">{date(l.purchase_orders?.purchase_date ?? null)}</div>
                </td>
                <td className="num">{units(l.units)}</td>
                <td className="num">{money(l.unit_cost)}</td>
                {types.map((t) => <td key={t} className="num muted">{m[t] ? money(m[t] / l.units) : "—"}</td>)}
                <td className="num font-semibold">{money(l.landed_unit_cost ?? l.unit_cost)}</td>
                <td><Link href={`/compras/costos/nuevo?po=${l.purchase_orders?.id}&product=${productId}`} className="inline-flex items-center gap-1 text-xs link whitespace-nowrap"><Plus size={12} /> Costo</Link></td>
              </tr>
            );
          })}
          {lines.length > 0 && (
            <tr style={{ background: "var(--bg)" }}>
              <td className="font-medium">Promedio ponderado</td>
              <td className="num">{units(totalUnits)}</td>
              <td className="num">{money(avg((l) => l.units * Number(l.unit_cost)))}</td>
              {types.map((t) => <td key={t} className="num">{money(avg((l) => perLine.get(l.id)?.[t] ?? 0))}</td>)}
              <td className="num font-semibold">{money(avg((l) => l.units * Number(l.landed_unit_cost ?? l.unit_cost)))}</td>
              <td />
            </tr>
          )}
          {lines.length === 0 && <tr><td colSpan={types.length + 5} className="muted">Este producto aún no tiene compras.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
