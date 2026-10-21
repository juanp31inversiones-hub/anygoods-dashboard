import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { ShipmentForm } from "@/components/ShipmentForm";
import { BackLink } from "@/components/ui";

export default async function EnvioAmazon({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const products = await stockByLocation(await createClient());
  return (
    <div className="space-y-4">
      <BackLink href="/inventario" label="Inventario" />
      <div>
        <h1 className="text-2xl font-semibold">Enviar a Amazon</h1>
        <p className="muted text-sm">Elige de dónde salen las unidades y cuántas envías de cada producto. El resto se queda en tu inventario.</p>
      </div>
      <ShipmentForm products={products} defaultProduct={product} />
    </div>
  );
}
