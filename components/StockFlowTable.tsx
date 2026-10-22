import Link from "next/link";
import { money, units } from "@/lib/format";
import { ReconcileButton } from "@/components/AmazonControls";

const OUTSIDE = ["own_warehouse", "supplier_warehouse", "prep_center"];

export type StockMove = { product_id: string; movement: string; qty: number; location: string; reference: string | null; notes: string | null };
export type StockProduct = { product_id: string; description: string; image_url: string | null; avg_cost: number | null; inventory_value: number | string; stock: Record<string, number> };

/** Totales por producto: lo comprado, lo enviado, lo vendido, lo perdido y lo que queda (y dónde). */
function summarize(p: StockProduct, moves: StockMove[]) {
  const t = { bought: 0, sent: 0, sold: 0, claims: 0, pendingClaims: 0, other: 0 };
  for (const m of moves) {
    if (m.product_id !== p.product_id) continue;
    if (m.movement === "purchase") t.bought += m.qty;
    else if (m.movement === "transfer") { if (OUTSIDE.includes(m.location) && m.qty < 0) t.sent -= m.qty; }
    else if (m.movement === "sale" || m.movement === "customer_return") t.sold -= m.qty;
    else if (m.movement === "reimbursed") t.claims -= m.qty;
    else if (m.movement === "adjustment" && m.qty < 0 && /faltante/i.test(`${m.reference} ${m.notes}`)) { t.claims -= m.qty; t.pendingClaims -= m.qty; }
    else t.other -= m.qty;
  }
  const outside = OUTSIDE.reduce((a, l) => a + (p.stock[l] ?? 0), 0);
  const inbound = p.stock.fba_inbound ?? 0;
  const amazon = p.stock.amazon_fba ?? 0;
  return { ...t, outside, inbound, amazon, available: outside + inbound + amazon };
}

export function StockFlowTable({ products, moves, amazonSays }: { products: StockProduct[]; moves: StockMove[]; amazonSays: Map<string, number> }) {
  const rows = products.map((p) => ({ p, s: summarize(p, moves) }));
  const sum = (k: keyof ReturnType<typeof summarize>) => rows.reduce((a, r) => a + (r.s[k] as number), 0);
  const value = rows.reduce((a, r) => a + Number(r.p.inventory_value), 0);
  const sticky = { background: "var(--surface)", position: "sticky" as const, left: 0, zIndex: 1 };
  const sep = { borderLeft: "2px solid var(--border)" };

  return (
    <section className="card overflow-x-auto">
      <table className="data min-w-[760px]">
        <thead>
          <tr>
            <th style={sticky} />
            <th colSpan={5} className="text-center text-xs">Qué pasó con lo que compraste</th>
            <th className="num text-xs" style={sep} />
            <th colSpan={3} className="text-center text-xs" style={sep}>Dónde están</th>
            <th />
          </tr>
          <tr>
            <th style={sticky}>Producto</th>
            <th className="num">Compradas</th>
            <th className="num">Enviadas a Amazon</th>
            <th className="num">Vendidas</th>
            <th className="num">Perdidas / reclamos</th>
            <th className="num">Otras salidas</th>
            <th className="num" style={sep}>Disponibles</th>
            <th className="num" style={sep}>Proveedor / bodega</th>
            <th className="num">Camino a Amazon</th>
            <th className="num">En Amazon</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, s }) => {
            const says = amazonSays.get(p.product_id);
            return (
              <tr key={p.product_id}>
                <td style={sticky} className="max-w-[150px] sm:max-w-[260px]">
                  <Link href={`/productos/${p.product_id}`} className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded shrink-0 overflow-hidden" style={{ background: "var(--bg)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-contain" />}
                    </span>
                    <span className="line-clamp-2 text-xs sm:text-sm">{p.description}</span>
                  </Link>
                </td>
                <td className="num">{units(s.bought)}</td>
                <td className="num">{units(s.sent)}</td>
                <td className="num">{units(s.sold)}</td>
                <td className="num">
                  {s.claims ? units(s.claims) : <span className="muted">0</span>}
                  {s.pendingClaims > 0 && <div className="neg text-[11px]">{units(s.pendingClaims)} por reclamar</div>}
                </td>
                <td className="num">{s.other ? units(s.other) : <span className="muted">0</span>}</td>
                <td className="num font-semibold" style={sep}>{units(s.available)}</td>
                <td className="num" style={sep}>{s.outside ? units(s.outside) : <span className="muted">0</span>}</td>
                <td className="num">{s.inbound ? units(s.inbound) : <span className="muted">0</span>}</td>
                <td className="num">
                  {units(s.amazon)}
                  {says !== undefined && says !== s.amazon && (
                    <div className="text-[11px] space-y-1">
                      <div className="neg">Amazon: {units(says)}</div>
                      <ReconcileButton productId={p.product_id} label="Cuadrar" />
                    </div>
                  )}
                </td>
                <td className="num">{money(p.inventory_value)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={11} className="muted">No hay productos con stock.</td></tr>}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="font-semibold">
              <td style={sticky}>Total</td>
              <td className="num">{units(sum("bought"))}</td>
              <td className="num">{units(sum("sent"))}</td>
              <td className="num">{units(sum("sold"))}</td>
              <td className="num">{units(sum("claims"))}</td>
              <td className="num">{units(sum("other"))}</td>
              <td className="num" style={sep}>{units(sum("available"))}</td>
              <td className="num" style={sep}>{units(sum("outside"))}</td>
              <td className="num">{units(sum("inbound"))}</td>
              <td className="num">{units(sum("amazon"))}</td>
              <td className="num">{money(value)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="muted text-xs px-4 py-3">
        Compradas − Vendidas − Perdidas − Otras salidas = <b>Disponibles</b>. “Enviadas” solo informa cuántas mandaste a Amazon (siguen siendo tuyas hasta venderse).
        “Otras salidas”: liquidadas, desechadas, retiradas o ajustes.
      </p>
    </section>
  );
}
