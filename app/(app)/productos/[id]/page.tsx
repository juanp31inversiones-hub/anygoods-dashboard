import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, type Product } from "@/components/ProductForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deleteProduct } from "@/lib/actions";
import { LOCATION_LABELS, MOVEMENT_LABELS, date, money, units } from "@/lib/format";

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: product }, { data: stock }, { data: lines }, { data: moves }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).single<Product>(),
    supabase.from("v_inventory_on_hand").select("*").eq("product_id", id).single(),
    supabase.from("purchase_order_lines")
      .select("units, unit_cost, landed_unit_cost, purchase_orders(id, invoice_number, purchase_date, counterparties!purchase_orders_supplier_id_fkey(name))")
      .eq("product_id", id),
    supabase.from("inventory_movements").select("id, movement, qty, location, occurred_on, reference, notes").eq("product_id", id).order("occurred_on", { ascending: false }),
  ]);
  if (!product) notFound();

  type L = { units: number; unit_cost: number; landed_unit_cost: number | null; purchase_orders: { id: string; invoice_number: string | null; purchase_date: string; counterparties: { name: string } | null } | null };

  return (
    <div className="space-y-6 max-w-4xl">
      <BackLink href="/productos" label="Productos" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{product.description}</h1>
        <DeleteButton action={deleteProduct.bind(null, id)} confirmText="¿Eliminar este producto? Si tiene compras asociadas, desactívalo en su lugar." />
      </div>

      {stock && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3"><div className="muted text-xs">En FBA</div><div className="text-lg font-semibold">{units(stock.units_fba)}</div></div>
          <div className="card p-3"><div className="muted text-xs">Fuera de FBA</div><div className="text-lg font-semibold">{units(stock.units_other)}</div></div>
          <div className="card p-3"><div className="muted text-xs">Costo promedio</div><div className="text-lg font-semibold">{money(stock.avg_cost)}</div></div>
          <div className="card p-3"><div className="muted text-xs">Valor a costo</div><div className="text-lg font-semibold">{money(stock.inventory_value)}</div></div>
        </div>
      )}

      <ProductForm product={product} />

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Compras</h2>
        <table className="data mt-2">
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th className="num">Unidades</th><th className="num">Costo und</th><th className="num">Costo final und</th></tr></thead>
          <tbody>
            {((lines ?? []) as unknown as L[]).map((l, i) => (
              <tr key={i}>
                <td>{date(l.purchase_orders?.purchase_date ?? null)}</td>
                <td>{l.purchase_orders?.counterparties?.name}</td>
                <td><Link className="link" href={`/compras/${l.purchase_orders?.id}`}>{l.purchase_orders?.invoice_number ?? "Ver"}</Link></td>
                <td className="num">{units(l.units)}</td>
                <td className="num">{money(l.unit_cost)}</td>
                <td className="num">{money(l.landed_unit_cost ?? l.unit_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
