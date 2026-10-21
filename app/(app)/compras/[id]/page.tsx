import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formOptions } from "@/lib/queries";
import { POForm } from "@/components/POForm";
import { PODocuments, type PODocument } from "@/components/PODocuments";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deletePurchaseOrder, type POPayload } from "@/lib/actions";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditarCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [opts, { data: po }, { data: docs }] = await Promise.all([
    formOptions(supabase),
    supabase.from("purchase_orders").select("*, purchase_order_lines(id, product_id, cases, units, unit_cost), additional_costs(id, cost_type, description, amount, product_id, allocation, cost_date, counterparty_id)").eq("id", id).single(),
    supabase.from("po_documents").select("id, doc_type, file_path, file_name, size_bytes, created_at").eq("purchase_order_id", id).order("created_at"),
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
    notes: s(po.notes),
    location: "own_warehouse",
    lines: (po.purchase_order_lines as { id: string; product_id: string; cases: number | null; units: number; unit_cost: number }[]).map((l) => ({
      id: l.id, product_id: l.product_id, cases: s(l.cases), units: s(l.units), unit_cost: s(l.unit_cost),
    })),
    costs: (po.additional_costs as { id: string; cost_type: string; description: string | null; amount: number; product_id: string | null; allocation: "units" | "value"; cost_date: string | null; counterparty_id: string | null }[]).map((c) => ({
      id: c.id, cost_type: c.cost_type, description: s(c.description),
      amount: s(c.cost_type === "supplier_discount" ? Math.abs(Number(c.amount)) : c.amount),
      product_id: s(c.product_id), allocation: c.allocation, cost_date: s(c.cost_date), counterparty_id: s(c.counterparty_id),
    })),
  };

  return (
    <div className="space-y-4">
      <BackLink href="/compras" label="Compras" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Orden {po.invoice_number ?? ""}</h1>
        <DeleteButton action={deletePurchaseOrder.bind(null, id)} confirmText="¿Eliminar esta orden? Se borran sus líneas y movimientos de inventario, y se desvinculan los pagos." />
      </div>
      <p className="muted text-sm">Al guardar se recalcula el costo neto por unidad de cada producto con sus costos adicionales.</p>
      <PODocuments poId={id} docs={(docs ?? []) as PODocument[]} />
      <POForm initial={initial} suppliers={opts.counterparties} products={opts.products} />
    </div>
  );
}
