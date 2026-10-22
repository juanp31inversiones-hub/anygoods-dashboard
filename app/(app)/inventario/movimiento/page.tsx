import { createClient } from "@/lib/supabase/server";
import { MovementForm } from "@/components/MovementForm";
import { BackLink } from "@/components/ui";

export default async function NuevoMovimientoInventario({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id, description").eq("active", true).order("description");
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/inventario" label="Inventario" />
      <h1 className="text-xl md:text-2xl font-semibold">Registrar movimiento de inventario</h1>
      <MovementForm products={data ?? []} defaultProduct={product} />
    </div>
  );
}
