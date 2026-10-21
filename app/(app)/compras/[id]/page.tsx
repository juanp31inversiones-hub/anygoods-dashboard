import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formOptions } from "@/lib/queries";
import { POForm } from "@/components/POForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deletePurchaseOrder, type POPayload } from "@/lib/actions";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditarCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [opts, { data: po }] = await Promise.all([
    formOptions(supabase),
    supabase.from("purchase_orders").select("*, purchase_order_lines(id, product_id, cases, units, unit_cost)").eq("id", id).single(),
  ]);
  if (!po) notFound();

  const initial: POPayload = {
    id: po.id,
    supplier_id: s(po.supplier_id),
    paid_via_id: s(po.paid_via_id),
    po_number: s(po.po_number),
    invoice_number: s(po.invoice_number),
    purchase_date: s(po.purchase_date),
    arrival_date: s(po.arrival_date),
    status: s(po.status),
    supplier_shipping: s(po.supplier_shipping),
    amazon_shipping: s(po.amazon_shipping),
    amazon_placement_fee: s(po.amazon_placement_fee),
    prep_cost: s(po.prep_cost),
    notes: s(po.notes),
    location: "amazon_fba",
    lines: (po.purchase_order_lines as { id: string; product_id: string; cases: number | null; units: number; unit_cost: number }[]).map((l) => ({
      id: l.id, product_id: l.product_id, cases: s(l.cases), units: s(l.units), unit_cost: s(l.unit_cost),
    })),
  };

  return (
    <div className="space-y-4">
      <BackLink href="/compras" label="Compras" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Orden {po.invoice_number ?? ""}</h1>
        <DeleteButton action={deletePurchaseOrder.bind(null, id)} confirmText="¿Eliminar esta orden? Se borran sus líneas y movimientos de inventario, y se desvinculan los pagos." />
      </div>
      <p className="muted text-sm">Al guardar se recalcula el costo final por unidad repartiendo la logística según el valor de cada producto.</p>
      <POForm initial={initial} suppliers={opts.counterparties} products={opts.products} />
    </div>
  );
}
