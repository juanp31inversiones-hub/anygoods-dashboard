import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CounterpartyForm, type Counterparty } from "@/components/CounterpartyForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { AgentAccount, type LedgerRow } from "@/components/AgentAccount";
import { deleteCounterparty } from "@/lib/actions";
import { AGENT_ENTRY_LABELS, STATUS_LABELS, date, money } from "@/lib/format";

export default async function EditarProveedor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: cp }, { data: pos }] = await Promise.all([
    supabase.from("counterparties").select("*").eq("id", id).single<Counterparty>(),
    supabase.from("purchase_orders").select("id, invoice_number, purchase_date, status, purchase_order_lines(units, unit_cost)").eq("supplier_id", id).order("purchase_date", { ascending: false }),
  ]);
  if (!cp) notFound();

  // Cuenta con el tercero (si maneja dinero nuestro)
  const [{ data: deposits }, { data: entries }, { data: paidFor }, { data: legacy }] = await Promise.all([
    supabase.from("bank_transactions").select("txn_date, description, amount, category").eq("counterparty_id", id).or("category.eq.inventory,amount.gt.0"),
    supabase.from("agent_entries").select("id, entry_date, kind, amount, description").eq("counterparty_id", id),
    supabase.from("po_payments").select("paid_on, amount, purchase_orders(po_number, invoice_number, supplier:counterparties!purchase_orders_supplier_id_fkey(name))").eq("paid_by_id", id).eq("method", "third_party"),
    supabase.from("purchase_orders").select("id").eq("paid_via_id", id).limit(1),
  ]);
  type PF = { paid_on: string; amount: number; purchase_orders: { po_number: string | null; invoice_number: string | null; supplier: { name: string } | null } | null };
  const ledger: LedgerRow[] = [
    ...(deposits ?? []).map((t) => ({
      date: t.txn_date, amount: -Number(t.amount),
      concept: Number(t.amount) < 0 ? "Depósito desde nuestro banco" : "Nos devolvió dinero",
      detail: t.description,
    })),
    ...(entries ?? []).map((e) => ({
      id: e.id, date: e.entry_date, amount: Number(e.amount), deletable: true,
      concept: AGENT_ENTRY_LABELS[e.kind] ?? e.kind, detail: e.description ?? "",
    })),
    ...((paidFor ?? []) as unknown as PF[]).map((p) => ({
      date: p.paid_on, amount: -Number(p.amount), concept: "Pagó una compra por nosotros",
      detail: `${p.purchase_orders?.supplier?.name ?? ""} · ${p.purchase_orders?.po_number ?? "Factura " + (p.purchase_orders?.invoice_number ?? "")}`,
    })),
  ];
  const isAgent = ledger.length > 0 || (legacy ?? []).length > 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <BackLink href="/proveedores" label="Proveedores" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-semibold">{cp.name}</h1>
        <DeleteButton action={deleteCounterparty.bind(null, id)} confirmText={`¿Eliminar ${cp.name}?`} />
      </div>
      {isAgent && <AgentAccount counterpartyId={id} name={cp.name} rows={ledger} />}
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
