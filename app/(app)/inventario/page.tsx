import Link from "next/link";
import { ArrowRightLeft, ClipboardCheck, PackageMinus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DeleteButton } from "@/components/forms";
import { Badge, PageHeader, RowLink } from "@/components/ui";
import { deleteMovement } from "@/lib/actions";
import { LOCATION_LABELS, MOVEMENT_LABELS, date, money, units } from "@/lib/format";

const TABS = [
  { key: "stock", label: "Con stock" },
  { key: "empty", label: "Agotados" },
  { key: "all", label: "Todos" },
];

export default async function Inventario({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "stock" } = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: moves }] = await Promise.all([
    supabase.from("v_inventory_on_hand").select("*").order("inventory_value", { ascending: false }),
    supabase.from("inventory_movements")
      .select("id, movement, qty, location, occurred_on, reference, notes, products(id, description)")
      .neq("movement", "purchase").order("occurred_on", { ascending: false }).limit(50),
  ]);
  const all = data ?? [];
  const withStock = all.filter((r) => Number(r.units_on_hand) !== 0);
  const rows = tab === "empty" ? all.filter((r) => Number(r.units_on_hand) === 0) : tab === "all" ? all : withStock;
  const total = withStock.reduce((a, r) => a + Number(r.inventory_value), 0);
  const unitsTotal = withStock.reduce((a, r) => a + Number(r.units_on_hand), 0);
  type M = { id: string; movement: string; qty: number; location: string; occurred_on: string; reference: string | null; notes: string | null; products: { id: string; description: string } | null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        subtitle={`${units(unitsTotal)} unidades en ${withStock.length} productos · ${money(total)} a costo`}
        actions={[
          { href: "/inventario/conteo", label: "Conteo y salidas", icon: ClipboardCheck },
          { href: "/inventario/movimiento", label: "Registrar movimiento", icon: Plus },
        ]}
      />

      <div className="card p-4 text-sm flex flex-wrap items-center gap-3" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
        <span className="flex-1 min-w-[240px]">
          <strong>¿Hay productos que ya no tienes?</strong> Las ventas de Amazon aún no se descuentan solas. Usa <em>Conteo y salidas</em> para dejar el inventario igual a la realidad.
        </span>
        <Link href="/inventario/conteo" className="btn-primary"><ClipboardCheck size={16} /> Hacer conteo</Link>
      </div>

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
              <th className="num">En FBA</th><th className="num">Fuera de FBA</th><th className="num">Total</th>
              <th className="num">Costo prom.</th><th className="num">Valor a costo</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = Number(r.units_on_hand) === 0;
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
                          {Number(r.units_other) > 0 && <Badge tone="warn">Stock fuera de FBA</Badge>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{units(r.units_fba)}</td>
                  <td className="num">{units(r.units_other)}</td>
                  <td className="num font-medium">{units(r.units_on_hand)}</td>
                  <td className="num">{r.avg_cost ? money(r.avg_cost) : "—"}</td>
                  <td className="num">{money(r.inventory_value)}</td>
                  <td>
                    {!empty && (
                      <div className="flex gap-1">
                        <RowLink href={`/inventario/conteo?product=${r.product_id}`} label="Dar salida" icon={PackageMinus} tone="primary" />
                        <RowLink href={`/inventario/movimiento?product=${r.product_id}`} label="Trasladar" icon={ArrowRightLeft} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No hay productos en esta vista.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Historial de salidas, traslados y ajustes</h2>
        <p className="muted text-xs px-4">Las compras se gestionan desde Compras. Si te equivocas, elimina el movimiento con ✕.</p>
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
                <td><DeleteButton action={deleteMovement.bind(null, m.id)} label="✕" confirmText="¿Eliminar este movimiento?" /></td>
              </tr>
            ))}
            {(moves ?? []).length === 0 && <tr><td colSpan={7} className="muted">Sin movimientos manuales todavía.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
