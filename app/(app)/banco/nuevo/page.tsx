import { createClient } from "@/lib/supabase/server";
import { formOptions } from "@/lib/queries";
import { TxnForm } from "@/components/TxnForm";
import { BackLink } from "@/components/ui";

export default async function NuevoMovimiento() {
  const o = await formOptions(await createClient());
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/banco" label="Banco" />
      <h1 className="text-xl md:text-2xl font-semibold">Nuevo movimiento bancario</h1>
      <TxnForm accounts={o.accounts} counterparties={o.counterparties} partners={o.partners} purchaseOrders={o.purchaseOrders} customCategories={o.customCategories} />
    </div>
  );
}
