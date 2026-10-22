import Link from "next/link";
import { Send } from "lucide-react";
import { RowLink } from "@/components/ui";
import { LOCATION_LABELS, money, units } from "@/lib/format";

const OUTSIDE = ["own_warehouse", "supplier_warehouse", "prep_center"];

export type FlowMove = { product_id: string; movement: string; qty: number; location: string; reference: string | null; notes: string | null };
export type FlowProduct = { product_id: string; description: string; image_url: string | null; avg_cost: number | null; stock: Record<string, number> };

/** Por producto: compradas, menos todo lo que salió (ventas, liquidaciones, pérdidas…), igual a lo que tienes hoy y dónde. */
export function ProductFlow({ products, moves }: { products: FlowProduct[]; moves: FlowMove[] }) {
  if (!products.length) return <p className="muted text-sm">No hay productos con stock.</p>;
  const kind = (m: FlowMove) => {
    if (m.movement === "purchase") return "bought";
    if (m.movement === "transfer") return null;
    if (m.movement === "sale") return m.location === "amazon_fba" ? "soldAmazon" : "soldOther";
    if (m.movement === "customer_return") return "returned";
    if (m.movement === "liquidation") return "liquidated";
    if (m.movement === "reimbursed") return "reimbursed";
    if (m.movement === "damaged") return "damaged";
    if (m.movement === "removal") return "removed";
    if (m.movement === "adjustment" && m.qty < 0 && /faltante/i.test(`${m.reference} ${m.notes}`)) return "missing";
    return "adjusted";
  };
  const LINES: { key: string; label: string; hint?: string }[] = [
    { key: "soldAmazon", label: "Vendidas en Amazon" },
    { key: "soldOther", label: "Vendidas a otros clientes" },
    { key: "returned", label: "Devueltas por clientes" },
    { key: "liquidated", label: "Liquidadas" },
    { key: "reimbursed", label: "Perdidas que Amazon te pagó" },
    { key: "missing", label: "Faltantes en Amazon", hint: "Reclámalas a Amazon (Help → Investigate inventory)" },
    { key: "damaged", label: "Dañadas o desechadas" },
    { key: "removed", label: "Retiradas de Amazon" },
    { key: "adjusted", label: "Otros ajustes" },
  ];
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      {products.map((p) => {
        const t: Record<string, number> = {};
        for (const m of moves.filter((x) => x.product_id === p.product_id)) {
          const k = kind(m);
          if (k) t[k] = (t[k] ?? 0) + m.qty;
        }
        const today = Object.values(p.stock).reduce((a, b) => a + b, 0);
        const where = [
          ["En Amazon", p.stock.amazon_fba ?? 0],
          ["Camino a Amazon", p.stock.fba_inbound ?? 0],
          ...OUTSIDE.map((l) => [LOCATION_LABELS[l], p.stock[l] ?? 0] as [string, number]),
        ].filter(([, q]) => q !== 0) as [string, number][];
        return (
          <div key={p.product_id} className="card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-10 h-10 rounded shrink-0 overflow-hidden" style={{ background: "var(--bg)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-contain" />}
              </span>
              <Link href={`/productos/${p.product_id}`} className="font-medium link">{p.description}</Link>
            </div>
            <table className="data text-sm">
              <tbody>
                <tr><td>Compradas</td><td className="num">{units(t.bought ?? 0)}</td></tr>
                {LINES.filter((l) => t[l.key]).map((l) => (
                  <tr key={l.key}>
                    <td className="muted">
                      {t[l.key] > 0 ? "+" : "−"} {l.label}
                      {l.hint && <div className="text-xs neg">{l.hint}</div>}
                    </td>
                    <td className={`num ${l.key === "missing" ? "neg" : ""}`}>{units(Math.abs(t[l.key]))}</td>
                  </tr>
                ))}
                <tr className="font-semibold"><td>= Tienes hoy</td><td className="num">{units(today)}</td></tr>
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2 text-xs">
              {where.map(([label, q]) => (
                <span key={label} className="rounded-full px-2.5 py-1" style={{ background: "var(--bg)" }}>{label}: <b>{units(q)}</b></span>
              ))}
              <span className="rounded-full px-2.5 py-1" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                Valor: <b>{money(today * Number(p.avg_cost ?? 0))}</b>
              </span>
            </div>
            <div className="flex gap-2">
              {OUTSIDE.some((l) => (p.stock[l] ?? 0) > 0) && <RowLink href={`/envios/nuevo?product=${p.product_id}`} label="Enviar a Amazon" icon={Send} tone="primary" />}
              <RowLink href={`/inventario?product=${p.product_id}#historial`} label="Ver historial" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
