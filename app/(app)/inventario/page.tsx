import Link from "next/link";
import { ClipboardCheck, PackageMinus, Plus, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { DeleteButton } from "@/components/forms";
import { Badge, PageHeader, RowLink } from "@/components/ui";
import { deleteMovement } from "@/lib/actions";
import { LOCATIONS, LOCATION_LABELS, MOVEMENT_LABELS, date, money, units } from "@/lib/format";

const TABS = [
  { key: "stock", label: "Con stock" },
  { key: "empty", label: "Agotados" },
  { key: "all", label: "Todos" },
];

export default async function Inventario({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "stock" } = await searchParams;
  const supabase = await createClient();
  const [all, { data: moves }] = await Promise.all([
    stockByLocation(supabase, false),
    supabase.from("inventory_movements")
      .select("id, movement, qty, location, occurred_on, reference, notes, products(id, description)")
      .neq("movement", "purchase").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(60),
  ]);
  const withStock = all.filter((r) => Number(r.units_on_hand) !== 0);
  const rows = tab === "empty" ? all.filter((r) => Number(r.units_on_hand) === 0) : tab === "all" ? all : withStock;
  // Solo columnas de ubicaciones que tienen o tuvieron stock
  const usedLocations = LOCATIONS.filter((loc) => loc === "own_warehouse" || loc === "amazon_fba" || all.some((r) => (r.stock[loc] ?? 0) !== 0));
  const totalsByLoc = Object.fromEntries(usedLocations.map((loc) => [loc, withStock.reduce((a, r) => a + (r.stock[loc] ?? 0), 0)]));
  const totalValue = withStock.reduce((a, r) => a + Number(r.inventory_value), 0);

  type M = { id: string; movement: string; qty: number; location: string; occurred_on: string; reference: string | null; notes: string | null; products: { id: string; description: string } | null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        subtitle={`${withStock.length} productos con stock · ${money(totalValue)} a costo neto`}
        actions={[
          { href: "/inventario/envio", label: "Enviar a Amazon", icon: Send },
          { href: "/inventario/conteo", label: "Conteo y salidas", icon: ClipboardCheck },
          { href: "/inventario/movimiento", label: "Otro movimiento", icon: Plus },
        ]}
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {usedLocations.map((loc) => (
          <div key={loc} className="card p-4">
            <div className="muted text-xs uppercase tracking-wide">{LOCATION_LABELS[loc]}</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{units(totalsByLoc[loc])}</div>
            <div className="muted text-xs">unidades</div>
          </div>
        ))}
      </section>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/inventario?tab=${t.key}`} className="px-4 py-2 text-sm -mb-px border-b-2"
            style={tab === t.key ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "transparent", color: "var(--muted)" }}>
            {t.label}
          </Link>
        ))}
      </div>

      <section className="card overflow-x-auto">
        <table className="data min-w-[900px]">
          <thead>
            <tr>
              <th>Producto</th>
              {usedLocations.map((loc) => <th key={loc} className="num">{LOCATION_LABELS[loc]}</th>)}
              <th className="num">Total</th><th className="num">Costo neto/u</th><th className="num">Valor</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = Number(r.units_on_hand) === 0;
              const notInFba = (r.stock.amazon_fba ?? 0) === 0 && !empty;
              return (
                <tr key={r.product_id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: "var(--bg)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.image_url && <img src={r.image_url} alt="" className="w-full h-full object-contain" />}
                      </div>
                      <div>
                        <Link href={`/productos/${r.product_id}`} className="link">{r.description}</Link>
                        <div className="flex gap-1 mt-0.5 items-center">
                          <span className="muted text-xs">{r.asin ?? ""}</span>
                          {empty && <Badge>Agotado</Badge>}
                          {!r.active && <Badge tone="muted">Inactivo</Badge>}
                          {notInFba && <Badge tone="warn">Sin stock en Amazon</Badge>}
                        </div>
                      </div>
                    </div>
                  </td>
                  {usedLocations.map((loc) => (
                    <td key={loc} className={`num ${(r.stock[loc] ?? 0) === 0 ? "muted" : ""}`}>{units(r.stock[loc] ?? 0)}</td>
                  ))}
                  <td className="num font-medium">{units(r.units_on_hand)}</td>
                  <td className="num">{r.avg_cost ? money(r.avg_cost) : "—"}</td>
                  <td className="num">{money(r.inventory_value)}</td>
                  <td>
                    {!empty && (
                      <div className="flex gap-1">
                        {Object.entries(r.stock).some(([loc, q]) => loc !== "amazon_fba" && q > 0) && (
                          <RowLink href={`/inventario/envio?product=${r.product_id}`} label="Enviar a Amazon" icon={Send} tone="primary" />
                        )}
                        <RowLink href={`/inventario/conteo?product=${r.product_id}`} label="Dar salida" icon={PackageMinus} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={usedLocations.length + 5} className="muted">No hay productos en esta vista. Las compras que registres aparecerán aquí.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Historial de envíos, salidas y ajustes</h2>
        <p className="muted text-xs px-4">Las entradas por compra se gestionan desde Compras. Si te equivocas, elimina el movimiento con ✕.</p>
        <table className="data mt-2">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Ubicación</th><th>Referencia</th><th className="num">Cantidad</th><th /></tr></thead>
          <tbody>
            {((moves ?? []) as unknown as M[]).map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{date(m.occurred_on)}</td>
                <td>{m.products?.description}</td>
                <td>{MOVEMENT_LABELS[m.movement] ?? m.movement}</td>
                <td>{LOCATION_LABELS[m.location] ?? m.location}</td>
                <td className="muted">{m.reference}{m.notes ? ` · ${m.notes}` : ""}</td>
                <td className={`num ${m.qty < 0 ? "neg" : "pos"}`}>{m.qty > 0 ? "+" : ""}{units(m.qty)}</td>
                <td><DeleteButton action={deleteMovement.bind(null, m.id)} label="✕" confirmText="¿Eliminar este movimiento? Si es parte de un envío, elimina también su contraparte (la otra ubicación)." /></td>
              </tr>
            ))}
            {(moves ?? []).length === 0 && <tr><td colSpan={7} className="muted">Sin movimientos todavía.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
