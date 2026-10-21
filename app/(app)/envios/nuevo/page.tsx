import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { FbaShipmentEditor } from "@/components/FbaShipmentEditor";
import { BackLink } from "@/components/ui";

export default async function NuevoEnvio({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const products = await stockByLocation(await createClient());
  return (
    <div className="space-y-4">
      <BackLink href="/envios" label="Envíos FBA" />
      <div>
        <h1 className="text-2xl font-semibold">Nuevo envío a Amazon</h1>
        <p className="muted text-sm">Registra cada Shipment ID que genera Send to Amazon. Si Amazon divide tu plan en varios centros, crea un envío por cada uno.</p>
      </div>
      <FbaShipmentEditor products={products} defaultProduct={product} />
    </div>
  );
}
