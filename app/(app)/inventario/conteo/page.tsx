import { createClient } from "@/lib/supabase/server";
import { StockCount, type StockRow } from "@/components/StockCount";
import { BackLink } from "@/components/ui";

export default async function Conteo({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const supabase = await createClient();
  const [{ data: moves }, { data: products }] = await Promise.all([
    supabase.from("inventory_movements").select("product_id, location, qty"),
    supabase.from("v_inventory_on_hand").select("product_id, description, asin, image_url, avg_cost"),
  ]);

  const byKey = new Map<string, number>();
  for (const m of moves ?? []) {
    const k = `${m.product_id}|${m.location}`;
    byKey.set(k, (byKey.get(k) ?? 0) + m.qty);
  }
  const info = new Map((products ?? []).map((p) => [p.product_id, p]));
  const rows: StockRow[] = [...byKey.entries()]
    // Lo que va en camino a Amazon se gestiona desde su envío
    .filter(([k, qty]) => qty !== 0 && !k.endsWith("|fba_inbound"))
    .map(([k, qty]) => {
      const [product_id, location] = k.split("|");
      const p = info.get(product_id);
      return { product_id, location, qty, description: p?.description ?? "", asin: p?.asin ?? null, image_url: p?.image_url ?? null, avg_cost: Number(p?.avg_cost ?? 0) };
    })
    .filter((r) => !product || r.product_id === product)
    .sort((a, b) => a.description.localeCompare(b.description));

  return (
    <div className="space-y-4">
      <BackLink href="/inventario" label="Inventario" />
      <div>
        <h1 className="text-2xl font-semibold">{product ? "Dar salida a un producto" : "Conteo y salidas de inventario"}</h1>
        <p className="muted text-sm">Ajusta el sistema a lo que realmente tienes.</p>
      </div>
      <StockCount rows={rows} focus={product} />
    </div>
  );
}
