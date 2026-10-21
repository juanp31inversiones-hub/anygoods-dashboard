import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DeleteButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { deleteMovement } from "@/lib/actions";
import { LOCATION_LABELS, MOVEMENT_LABELS, date, money, units } from "@/lib/format";

export default async function Inventario() {
  const supabase = await createClient();
  const [{ data }, { data: moves }] = await Promise.all([
    supabase.from("v_inventory_on_hand").select("*").eq("active", true).order("inventory_value", { ascending: false }),
    supabase.from("inventory_movements")
      .select("id, movement, qty, location, occurred_on, reference, notes, products(id, description)")
      .neq("movement", "purchase").order("occurred_on", { ascending: false }).limit(50),
  ]);
  const rows = data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.inventory_value), 0);
  type M = { id: string; movement: string; qty: number; location: string; occurred_on: string; reference: string | null; notes: string | null; products: { id: string; description: string } | null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        subtitle={`Valor a costo promedio: ${money(total)}. Las ventas de Amazon se descontarán al importar los reportes de Seller Central.`}
        action={{ href: "/inventario/movimiento", label: "Registrar movimiento" }}
      />
      <section className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Producto</th><th>ASIN</th>
              <th className="num">En FBA</th><th className="num">Fuera de FBA</th><th className="num">Total</th>
              <th className="num">Costo prom.</th><th className="num">Precio Amazon</th><th className="num">Valor a costo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id}>
                <td><Link href={`/productos/${r.product_id}`} className="link">{r.description}</Link></td>
                <td className="muted">{r.asin ?? "—"}</td>
                <td className="num">{units(r.units_fba)}</td>
                <td className="num">{units(r.units_other)}</td>
                <td className="num">{units(r.units_on_hand)}</td>
                <td className="num">{r.avg_cost ? money(r.avg_cost) : "—"}</td>
                <td className="num">{r.retail_price ? money(r.retail_price) : "—"}</td>
                <td className="num">{money(r.inventory_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Movimientos manuales recientes</h2>
        <p className="muted text-xs px-4">Las compras se gestionan desde la orden de compra.</p>
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
