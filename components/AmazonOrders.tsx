import { money, units } from "@/lib/format";
import { amazonDay } from "@/lib/tz";
import { Badge } from "@/components/ui";
import type { OrderLine } from "@/lib/amazon/orders";

export type OrderRow = { order_id: string; purchase_date: string; status: string; items: OrderLine[]; items_synced: boolean };

// Días de Amazon (hora del Pacífico), igual que Seller Central y su app
const localDay = (iso: string) => amazonDay(iso);

/** Ventas por fecha de compra, como "Units ordered" y "Sales" de Seller Central. */
export type OrderFees = { byOrder: Map<string, number>; perUnit: Map<string, number> };

export function AmazonOrders({ orders, since, until, nameOf, costOfSku, fees }: {
  orders: OrderRow[];
  since: string;
  until?: string;
  nameOf: (sku: string, title: string | null) => string;
  costOfSku: (sku: string) => number;
  fees: OrderFees;   // fees reales por pedido (ya despachado) y promedio por unidad para estimar los demás
}) {
  // Pedidos pendientes: Amazon aún no da el precio; se usa el último precio cobrado de ese SKU (como hace Seller Central).
  // Pedidos ya enviados sin precio (reemplazos o pedidos gratis) cuentan $0.
  const lastPrice = new Map<string, number>();
  for (const o of [...orders].sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))) {
    for (const i of o.items) if (i.price != null && i.qty) lastPrice.set(i.sku, i.price / i.qty);
  }
  const statusOf = new Map<OrderLine, string>();
  for (const o of orders) for (const i of o.items) statusOf.set(i, o.status);
  const priceOf = (i: OrderLine) => i.price ?? (statusOf.get(i) === "Pending" ? (lastPrice.get(i.sku) ?? 0) * i.qty : 0);
  const totals = (list: OrderRow[]) => ({
    units: list.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty, 0), 0),
    sales: list.reduce((a, o) => a + o.items.reduce((b, i) => b + priceOf(i), 0), 0),
    orders: list.length,
  });

  const today = localDay(new Date().toISOString());

  // Periodo elegido
  const inRange = orders.filter((o) => o.purchase_date >= since && (!until || o.purchase_date < until));
  const liveRange = inRange.filter((o) => o.status !== "Canceled");
  const byDay = new Map<string, number>();
  const salesDay = new Map<string, number>();
  for (const o of liveRange) {
    const d = localDay(o.purchase_date);
    byDay.set(d, (byDay.get(d) ?? 0) + o.items.reduce((b, i) => b + i.qty, 0));
    salesDay.set(d, (salesDay.get(d) ?? 0) + o.items.reduce((b, i) => b + priceOf(i), 0));
  }
  const days: string[] = [];
  for (let d = Date.parse(`${localDay(since)}T12:00:00Z`); d <= Date.parse(`${until ? localDay(new Date(Date.parse(until) - 1).toISOString()) : today}T12:00:00Z`); d += 86_400_000) {
    days.push(new Date(d).toISOString().slice(0, 10));
  }
  const maxDay = Math.max(1, ...days.map((d) => salesDay.get(d) ?? 0));

  const t = totals(liveRange);
  // Ganancia del periodo: ventas − lo que Amazon se queda − costo del producto
  let feesTotal = 0, cost = 0, estimated = 0;
  const feeOf = (o: OrderRow) => {
    if (fees.byOrder.has(o.order_id)) return fees.byOrder.get(o.order_id)!;
    estimated++;
    return o.items.reduce((b, i) => b + (fees.perUnit.get(i.sku) ?? 0) * i.qty, 0);
  };
  const productStats = new Map<string, { units: number; sales: number; fees: number; cost: number }>();
  for (const o of liveRange) {
    const f = feeOf(o);
    const oUnits = o.items.reduce((b, i) => b + i.qty, 0) || 1;
    feesTotal += f;
    for (const i of o.items) {
      const c = costOfSku(i.sku) * i.qty;
      cost += c;
      const k = nameOf(i.sku, i.title);
      const ps = productStats.get(k) ?? { units: 0, sales: 0, fees: 0, cost: 0 };
      ps.units += i.qty; ps.sales += priceOf(i); ps.fees += (f * i.qty) / oUnits; ps.cost += c;
      productStats.set(k, ps);
    }
  }
  const profit = t.sales - feesTotal - cost;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  // Resumen por día: pedidos por estado
  const dayMap = new Map<string, { day: string; orders: number; units: number; sales: number; shipped: number; pending: number; cancelled: number }>();
  for (const o of inRange) {
    const day = localDay(o.purchase_date);
    const d = dayMap.get(day) ?? { day, orders: 0, units: 0, sales: 0, shipped: 0, pending: 0, cancelled: 0 };
    if (o.status === "Canceled") d.cancelled++;
    else {
      d.orders++;
      d.units += o.items.reduce((b, i) => b + i.qty, 0);
      d.sales += o.items.reduce((b, i) => b + priceOf(i), 0);
      if (o.status === "Shipped") d.shipped++; else d.pending++;
    }
    dayMap.set(day, d);
  }
  const daily = [...dayMap.values()].sort((a, b) => b.day.localeCompare(a.day));
  const loading = orders.some((o) => !o.items_synced);

  return (
    <div className="space-y-4">
      {loading && <p className="muted text-xs">Algunos pedidos aún se están leyendo; pulsa “Sincronizar todo” para completarlos.</p>}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="muted text-xs">Ventas</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{money(t.sales)}</div>
          <div className="text-sm"><b>{units(t.units)}</b> unidades <span className="muted">· {t.orders} pedidos</span></div>
        </div>
        <div className="card p-4">
          <div className="muted text-xs">Amazon se queda</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums neg">{money(feesTotal)}</div>
          <div className="text-sm muted">{t.sales ? pct(feesTotal / t.sales) : "—"} de las ventas{estimated ? ` · ${estimated} pedido${estimated === 1 ? "" : "s"} estimado${estimated === 1 ? "" : "s"}` : ""}</div>
        </div>
        <div className="card p-4">
          <div className="muted text-xs">Costo del producto</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{money(cost)}</div>
          <div className="text-sm muted">{t.units ? `${money(cost / t.units)} por unidad` : "—"}</div>
        </div>
        <div className="card p-4" style={{ borderColor: profit < 0 ? "var(--neg)" : "var(--pos)" }}>
          <div className="muted text-xs">Ganancia</div>
          <div className={`text-2xl font-semibold mt-1 tabular-nums ${profit < 0 ? "neg" : "pos"}`}>{money(profit)}</div>
          <div className="text-sm">Margen <b>{t.sales ? pct(profit / t.sales) : "—"}</b> · ROI <b>{cost ? pct(profit / cost) : "—"}</b></div>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex justify-between items-baseline">
          <h3 className="font-medium">Ventas por día <span className="muted text-xs font-normal">(el número arriba de cada barra son unidades)</span></h3>
          <span className="text-sm"><b>{units(t.units)}</b> und · <b>{money(t.sales)}</b> en el periodo</span>
        </div>
        {days.length <= 62 ? (
          <div className="flex items-end gap-[3px] h-36">
            {days.map((d) => {
              const v = byDay.get(d) ?? 0;
              const $ = salesDay.get(d) ?? 0;
              return (
                <div key={d} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d}: ${money($)} · ${v} und`}>
                  {v > 0 && <span className="text-[10px] muted">{v}</span>}
                  <div className="w-full rounded-t" style={{ height: `${($ / maxDay) * 100}%`, minHeight: v ? 3 : 1, background: v ? "var(--accent)" : "var(--border)" }} />
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
        <section className="card overflow-x-auto lg:col-span-2">
          <h3 className="font-medium px-4 pt-4">Por producto</h3>
          <table className="data mt-2">
            <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Ventas</th><th className="num">Ganancia</th><th className="num">Margen</th><th className="num">ROI</th></tr></thead>
            <tbody>
              {[...productStats.entries()].sort((a, b) => b[1].sales - a[1].sales).map(([name, p]) => {
                const g = p.sales - p.fees - p.cost;
                return (
                  <tr key={name}>
                    <td>{name}</td><td className="num">{units(p.units)}</td><td className="num">{money(p.sales)}</td>
                    <td className={`num ${g < 0 ? "neg" : "pos"}`}>{money(g)}</td>
                    <td className="num">{p.sales ? pct(g / p.sales) : "—"}</td>
                    <td className="num">{p.cost ? pct(g / p.cost) : "—"}</td>
                  </tr>
                );
              })}
              {productStats.size === 0 && <tr><td colSpan={6} className="muted">Sin pedidos en este periodo.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card overflow-x-auto lg:col-span-2">
          <h3 className="font-medium px-4 pt-4">Pedidos por día y estado</h3>
          <table className="data mt-2">
            <thead>
              <tr>
                <th>Día</th><th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Ventas</th>
                <th className="num">Enviados</th><th className="num">Pendientes</th><th className="num">Cancelados</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.day}>
                  <td className="whitespace-nowrap">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className="num">{d.orders}</td>
                  <td className="num">{units(d.units)}</td>
                  <td className="num">{money(d.sales)}</td>
                  <td className="num">{d.shipped ? <Badge tone="pos">{d.shipped}</Badge> : <span className="muted">0</span>}</td>
                  <td className="num">{d.pending ? <Badge tone="warn">{d.pending}</Badge> : <span className="muted">0</span>}</td>
                  <td className="num">{d.cancelled ? <Badge tone="neg">{d.cancelled}</Badge> : <span className="muted">0</span>}</td>
                </tr>
              ))}
              {daily.length === 0 && <tr><td colSpan={7} className="muted">Sin pedidos en este periodo.</td></tr>}
            </tbody>
            {daily.length > 1 && (
              <tfoot>
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="num">{daily.reduce((a, d) => a + d.orders, 0)}</td>
                  <td className="num">{units(daily.reduce((a, d) => a + d.units, 0))}</td>
                  <td className="num">{money(daily.reduce((a, d) => a + d.sales, 0))}</td>
                  <td className="num">{daily.reduce((a, d) => a + d.shipped, 0)}</td>
                  <td className="num">{daily.reduce((a, d) => a + d.pending, 0)}</td>
                  <td className="num">{daily.reduce((a, d) => a + d.cancelled, 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="muted text-xs px-4 pb-3">Pedidos y unidades no cuentan los cancelados. “Pendientes” = el cliente aún no paga o Amazon aún no lo despacha.</p>
        </section>
      </div>
      <p className="muted text-xs">Igual que “Product sales” y “Units ordered” del celular: precio de lo que pidieron los clientes (sin impuestos ni envío), por día de compra. Es lo vendido, no la ganancia: la ganancia está en “Rentabilidad”.</p>
    </div>
  );
}
