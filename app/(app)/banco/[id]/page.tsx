import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formOptions } from "@/lib/queries";
import { TxnForm, type Txn } from "@/components/TxnForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deleteTransaction } from "@/lib/actions";

export default async function EditarMovimiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [o, { data: txn }] = await Promise.all([
    formOptions(supabase),
    supabase.from("bank_transactions").select("*").eq("id", id).single<Txn>(),
  ]);
  if (!txn) notFound();
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/banco" label="Banco" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-semibold">Editar movimiento</h1>
        <DeleteButton action={deleteTransaction.bind(null, id)} confirmText="¿Eliminar este movimiento bancario?" />
      </div>
      <TxnForm txn={txn} accounts={o.accounts} counterparties={o.counterparties} partners={o.partners} purchaseOrders={o.purchaseOrders} customCategories={o.customCategories} />
    </div>
  );
}
