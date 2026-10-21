import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { costFormOptions } from "@/lib/costQueries";
import { CostForm, type Cost } from "@/components/CostForm";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deleteCost } from "@/lib/actions";

export default async function EditarCosto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [o, { data: cost }] = await Promise.all([
    costFormOptions(supabase),
    supabase.from("additional_costs").select("*").eq("id", id).single<Cost>(),
  ]);
  if (!cost) notFound();
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/compras/costos" label="Costos adicionales" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Editar costo</h1>
        <DeleteButton action={deleteCost.bind(null, id)} confirmText="¿Eliminar este costo? Se recalculará el costo neto de los productos." />
      </div>
      <CostForm cost={cost} purchaseOrders={o.purchaseOrders} counterparties={o.counterparties} transactions={o.transactions} />
    </div>
  );
}
