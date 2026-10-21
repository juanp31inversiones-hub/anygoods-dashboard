import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader } from "@/components/ui";
import { Plus, Search } from "lucide-react";
import { money, units } from "@/lib/format";

export default async function Productos({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const { q, all } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("v_inventory_on_hand").select("*").order("description");
  if (!all) query = query.eq("active", true);
  const term = q?.replace(/[,()%*]/g, " ").trim();
  if (term) query = query.or(`description.ilike.%${term}%,asin.ilike.%${term}%,upc.ilike.%${term}%`);
  const { data } = await query;
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Productos" subtitle={`${rows.length} productos`} action={{ href: "/productos/nuevo", label: "Nuevo producto", icon: Plus }} />

      <form className="flex flex-wrap gap-2 items-center">
        <input name="q" defaultValue={q} placeholder="Buscar por nombre, ASIN o UPC" className="input max-w-sm" />
        <label className="text-sm flex items-center gap-2 muted">
          <input type="checkbox" name="all" value="1" defaultChecked={!!all} /> Incluir inactivos
        </label>
        <button className="btn-ghost"><Search size={16} /> Buscar</button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((p) => (
          <Link key={p.product_id} href={`/productos/${p.product_id}`} className="card p-3 flex gap-3 hover:shadow-sm" style={{ opacity: p.active ? 1 : 0.55 }}>
            <div className="w-20 h-20 shrink-0 rounded-md overflow-hidden flex items-center justify-center" style={{ background: "var(--bg)" }}>
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" className="w-full h-full object-contain" />
              ) : (
                <span className="muted text-[10px]">Sin imagen</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm leading-snug line-clamp-2">{p.description}</div>
              <div className="flex gap-1 mt-1">
                {Number(p.units_on_hand) === 0 && <Badge>Agotado</Badge>}
                {!p.active && <Badge tone="muted">Inactivo</Badge>}
              </div>
              <div className="muted text-xs mt-1">{p.asin ?? "Sin ASIN"}{p.retail_price ? ` · ${money(p.retail_price)}` : ""}</div>
              <div className="text-xs mt-1 tabular-nums">
                {units(p.units_on_hand)} und · {money(p.inventory_value)}
                {Number(p.units_other) > 0 && <span className="muted"> · {units(p.units_other)} fuera de FBA</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
