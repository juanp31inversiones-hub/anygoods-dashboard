import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CounterpartyForm, type Counterparty } from "@/components/CounterpartyForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deleteCounterparty } from "@/lib/actions";
import { STATUS_LABELS, date, money } from "@/lib/format";

export default async function EditarProveedor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: cp }, { data: pos }] = await Promise.all([
    supabase.from("counterparties").select("*").eq("id", id).single<Counterparty>(),
    supabase.from("purchase_orders").select("id, invoice_number, purchase_date, status, purchase_order_lines(units, unit_cost)").eq("supplier_id", id).order("purchase_date", { ascending: false }),
  ]);
  if (!cp) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      <BackLink href="/proveedores" label="Proveedores" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{cp.name}</h1>
        <DeleteButton action={deleteCounterparty.bind(null, id)} confirmText={`¿Eliminar ${cp.name}?`} />
      </div>
      <CounterpartyForm cp={cp} />
      {(pos ?? []).length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="font-semibold px-4 pt-4">Órdenes de compra</h2>
          <table className="data mt-2">
            <thead><tr><th>Fecha</th><th>Factura</th><th>Estado</th><th className="num">Producto</th></tr></thead>
            <tbody>
              {(pos ?? []).map((po) => (
                <tr key={po.id}>
                  <td>{date(po.purchase_date)}</td>
                  <td><Link className="link" href={`/compras/${po.id}`}>{po.invoice_number ?? "Ver"}</Link></td>
                  <td>{STATUS_LABELS[po.status] ?? po.status}</td>
                  <td className="num">{money((po.purchase_order_lines as { units: number; unit_cost: number }[]).reduce((a, l) => a + l.units * Number(l.unit_cost), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
