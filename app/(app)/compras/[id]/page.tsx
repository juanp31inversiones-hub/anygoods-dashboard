import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formOptions } from "@/lib/queries";
import { POForm } from "@/components/POForm";
import { PODocuments, type PODocument } from "@/components/PODocuments";
import { POPayments, type Payment } from "@/components/POPayments";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deletePurchaseOrder, type POPayload } from "@/lib/actions";
import { SUPPLIER_KINDS } from "@/lib/format";
import { stockByLocation } from "@/lib/stock";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditarCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [opts, { data: po }, { data: docs }, stockRows] = await Promise.all([
    formOptions(supabase),
    supabase.from("purchase_orders").select("*, purchase_order_lines(id, product_id, cases, units, unit_cost), additional_costs(id, cost_type, description, amount, product_id, allocation, cost_date, counterparty_id)").is("additional_costs.moved_to_shipment_id", null).eq("id", id).single(),
    supabase.from("po_documents").select("id, doc_type, file_path, file_name, size_bytes, created_at").eq("purchase_order_id", id).order("created_at"),
    stockByLocation(supabase, false),
  ]);
  if (!po) notFound();
  // Dónde llegó cada línea (movimiento de compra)
  const lineIds = (po.purchase_order_lines as { id: string }[]).map((l) => l.id);
  const { data: arrivals } = lineIds.length
    ? await supabase.from("inventory_movements").select("po_line_id, location").eq("movement", "purchase").in("po_line_id", lineIds)
    : { data: [] };
  const arrivalOf = new Map((arrivals ?? []).map((a) => [a.po_line_id as string, a.location as string]));
  const stock = Object.fromEntries(stockRows.map((r) => [r.product_id, r.stock]));

  // Pagos de la compra
  const [{ data: payments }, { data: status }, { data: txns }] = await Promise.all([
    supabase.from("po_payments").select("id, paid_on, amount, method, notes, paid_by:counterparties(name), bank:bank_transactions(txn_date, description)")
      .eq("purchase_order_id", id).order("paid_on"),
    supabase.from("v_po_payment_status").select("total").eq("purchase_order_id", id).single(),
    supabase.from("bank_transactions").select("id, txn_date, description, amount, purchase_order_id").lt("amount", 0)
      .or(`purchase_order_id.is.null,purchase_order_id.eq.${id}`).order("txn_date", { ascending: false }).limit(200),
  ]);
  const agents = opts.counterparties.filter((c) => c.kind !== "service" && c.kind !== "marketplace");

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
    location: arrivalOf.get(lineIds[0]) ?? "own_warehouse",
    lines: (po.purchase_order_lines as { id: string; product_id: string; cases: number | null; units: number; unit_cost: number }[]).map((l) => ({
      id: l.id, product_id: l.product_id, cases: s(l.cases), units: s(l.units), unit_cost: s(l.unit_cost), location: arrivalOf.get(l.id) ?? "own_warehouse",
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
      <POPayments
        poId={id}
        total={Number(status?.total ?? 0)}
        payments={(payments ?? []) as unknown as Payment[]}
        agents={agents}
        transactions={(txns ?? []).map((t) => ({ id: t.id, name: `${t.txn_date} · ${t.description} · $${Math.abs(Number(t.amount)).toFixed(2)}` }))}
      />
      <POForm initial={initial} suppliers={opts.counterparties.filter((c) => SUPPLIER_KINDS.includes(c.kind) || c.id === po.supplier_id || c.id === po.paid_via_id)} products={opts.products} stock={stock} />
    </div>
  );
}
