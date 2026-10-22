import { createClient } from "@/lib/supabase/server";
import { costFormOptions } from "@/lib/costQueries";
import { CostForm } from "@/components/CostForm";
import { BackLink } from "@/components/ui";

export default async function NuevoCosto({ searchParams }: { searchParams: Promise<{ po?: string; product?: string }> }) {
  const { po, product } = await searchParams;
  const o = await costFormOptions(await createClient());
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/compras/costos" label="Costos adicionales" />
      <h1 className="text-xl md:text-2xl font-semibold">Agregar costo adicional</h1>
      <p className="muted text-sm">El costo se reparte entre los productos de la orden y se recalcula su costo neto por unidad.</p>
      <CostForm purchaseOrders={o.purchaseOrders} counterparties={o.counterparties} transactions={o.transactions} defaultPo={po} defaultProduct={product} />
    </div>
  );
}
