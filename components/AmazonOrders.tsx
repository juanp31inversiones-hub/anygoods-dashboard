import { money, units } from "@/lib/format";
import { Badge } from "@/components/ui";
import type { OrderLine } from "@/lib/amazon/orders";

export type OrderRow = { order_id: string; purchase_date: string; status: string; items: OrderLine[]; items_synced: boolean };

const TZ_MS = 5 * 3_600_000; // Colombia (UTC−5), igual que el celular
const localDay = (iso: string) => new Date(Date.parse(iso) - TZ_MS).toISOString().slice(0, 10);
const STATUS: Record<string, { label: string; tone: "pos" | "warn" | "neg" | "muted" }> = {
  Pending: { label: "Pendiente de pago", tone: "warn" }, Unshipped: { label: "Por enviar", tone: "warn" },
  PartiallyShipped: { label: "Enviado parcial", tone: "warn" }, Shipped: { label: "Enviado", tone: "pos" },
  Canceled: { label: "Cancelado", tone: "neg" }, Unfulfillable: { label: "Sin stock", tone: "neg" },
};

/** Ventas por fecha de compra, como "Units ordered" y "Sales" de Seller Central. */
export function AmazonOrders({ orders, since, until, nameOf }: {
  orders: OrderRow[];
  since: string;
  until?: string;
  nameOf: (sku: string, title: string | null) => string;
}) {
  // Precio estimado para pedidos pendientes (Amazon no da el precio hasta que se cobra)
  const priced = new Map<string, { sum: number; qty: number }>();
  for (const o of orders) for (const i of o.items) if (i.price != null && i.qty) {
    const p = priced.get(i.sku) ?? { sum: 0, qty: 0 };
    p.sum += i.price; p.qty += i.qty; priced.set(i.sku, p);
  }
  const priceOf = (i: OrderLine) => i.price ?? (priced.get(i.sku) ? (priced.get(i.sku)!.sum / priced.get(i.sku)!.qty) * i.qty : 0);
  const live = orders.filter((o) => o.status !== "Canceled");
  const totals = (list: OrderRow[]) => ({
    units: list.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty, 0), 0),
    sales: list.reduce((a, o) => a + o.items.reduce((b, i) => b + priceOf(i), 0), 0),
    orders: list.length,
  });

  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 86_400_000).toISOString());
  const month = today.slice(0, 7);
  const prevMonthDate = new Date(`${month}-01T12:00:00Z`); prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const cards = [
    { label: "Hoy", t: totals(live.filter((o) => localDay(o.purchase_date) === today)) },
    { label: "Ayer", t: totals(live.filter((o) => localDay(o.purchase_date) === yesterday)) },
    { label: "Este mes", t: totals(live.filter((o) => localDay(o.purchase_date).startsWith(month))) },
    { label: "Mes pasado", t: totals(live.filter((o) => localDay(o.purchase_date).startsWith(prevMonth))) },
  ];

  // Periodo elegido
  const inRange = orders.filter((o) => o.purchase_date >= since && (!until || o.purchase_date < until));
  const liveRange = inRange.filter((o) => o.status !== "Canceled");
  const byDay = new Map<string, number>();
  for (const o of liveRange) byDay.set(localDay(o.purchase_date), (byDay.get(localDay(o.purchase_date)) ?? 0) + o.items.reduce((b, i) => b + i.qty, 0));
  const days: string[] = [];
  for (let d = Date.parse(`${localDay(since)}T12:00:00Z`); d <= Date.parse(`${until ? localDay(new Date(Date.parse(until) - 1).toISOString()) : today}T12:00:00Z`); d += 86_400_000) {
    days.push(new Date(d).toISOString().slice(0, 10));
  }
  const maxDay = Math.max(1, ...days.map((d) => byDay.get(d) ?? 0));
  const byProduct = new Map<string, { units: number; sales: number }>();
  for (const o of liveRange) for (const i of o.items) {
    const k = nameOf(i.sku, i.title);
    const p = byProduct.get(k) ?? { units: 0, sales: 0 };
    p.units += i.qty; p.sales += priceOf(i); byProduct.set(k, p);
  }
  const t = totals(liveRange);
  const loading = orders.some((o) => !o.items_synced);

  return (
    <div className="space-y-4">
      {loading && <p className="muted text-xs">Algunos pedidos aún se están leyendo; pulsa “Sincronizar todo” para completarlos.</p>}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="muted text-xs">{c.label}</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{units(c.t.units)} <span className="text-sm font-normal muted">und</span></div>
            <div className="text-sm tabular-nums">{money(c.t.sales)} <span className="muted">· {c.t.orders} pedidos</span></div>
          </div>
        ))}
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex justify-between items-baseline">
          <h3 className="font-medium">Unidades pedidas por día</h3>
          <span className="text-sm"><b>{units(t.units)}</b> und · <b>{money(t.sales)}</b> en el periodo</span>
        </div>
        {days.length <= 62 ? (
          <div className="flex items-end gap-[3px] h-36">
            {days.map((d) => {
              const v = byDay.get(d) ?? 0;
              return (
                <div key={d} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d}: ${v} und`}>
                  {v > 0 && <span className="text-[10px] muted">{v}</span>}
                  <div className="w-full rounded-t" style={{ height: `${(v / maxDay) * 100}%`, minHeight: v ? 3 : 1, background: v ? "var(--accent)" : "var(--border)" }} />
                </div>
              );
            })}
          </div>
        ) : <p className="muted text-sm">Elige un periodo de hasta 2 meses para ver el gráfico por día.</p>}
        {days.length <= 62 && days.length > 1 && (
          <div className="flex justify-between muted text-[10px]"><span>{days[0].slice(5)}</span><span>{days[days.length - 1].slice(5)}</span></div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-3">
        <section className="card overflow-x-auto">
          <h3 className="font-medium px-4 pt-4">Por producto</h3>
          <table className="data mt-2">
            <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Ventas</th></tr></thead>
            <tbody>
              {[...byProduct.entries()].sort((a, b) => b[1].units - a[1].units).map(([name, p]) => (
                <tr key={name}><td>{name}</td><td className="num">{units(p.units)}</td><td className="num">{money(p.sales)}</td></tr>
              ))}
              {byProduct.size === 0 && <tr><td colSpan={3} className="muted">Sin pedidos en este periodo.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card overflow-x-auto">
          <h3 className="font-medium px-4 pt-4">Pedidos</h3>
          <table className="data mt-2">
            <thead><tr><th>Fecha</th><th>Producto</th><th className="num">Und</th><th>Estado</th></tr></thead>
            <tbody>
              {inRange.slice().sort((a, b) => b.purchase_date.localeCompare(a.purchase_date)).slice(0, 100).map((o) => (
                <tr key={o.order_id}>
                  <td className="whitespace-nowrap text-xs">
                    {new Date(Date.parse(o.purchase_date) - TZ_MS).toISOString().slice(5, 16).replace("T", " ")}
                    <div className="muted">{o.order_id}</div>
                  </td>
                  <td className="text-sm">{o.items.map((i) => nameOf(i.sku, i.title)).join(", ") || <span className="muted">…</span>}</td>
                  <td className="num">{o.items.reduce((b, i) => b + i.qty, 0)}</td>
                  <td><Badge tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label ?? o.status}</Badge></td>
                </tr>
              ))}
              {inRange.length === 0 && <tr><td colSpan={4} className="muted">Sin pedidos en este periodo.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
      <p className="muted text-xs">Ventas = precio de los productos pedidos (sin impuestos), por fecha de compra en hora de Colombia, como en la app de Seller Central. Los pedidos pendientes usan el precio habitual del producto. La utilidad real está en la pestaña Rentabilidad.</p>
    </div>
  );
}
