import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { LinkSelect, ReconcileButton, SyncButtons } from "@/components/AmazonControls";
import { date, money, units } from "@/lib/format";
import { missingCredentials } from "@/lib/amazon/spapi";
import { AmazonOrders, type OrderFees, type OrderRow } from "@/components/AmazonOrders";

export const maxDuration = 300;

const TABS = [
  { key: "pedidos", label: "Ventas" },
  { key: "rentabilidad", label: "Rentabilidad por producto" },
  { key: "inventario", label: "Inventario FBA" },
  { key: "pagos", label: "Pagos vs banco" },
  { key: "cargos", label: "Cargos de la cuenta" },
  { key: "skus", label: "SKUs" },
];
const PERIODS = [
  { key: "today", label: "Hoy" }, { key: "yesterday", label: "Ayer" }, { key: "7", label: "7 días" }, { key: "30", label: "30 días" },
  { key: "month", label: "Este mes" }, { key: "lastmonth", label: "Mes pasado" }, { key: "90", label: "90 días" },
  { key: "year", label: "Este año" }, { key: "365", label: "12 meses" }, { key: "all", label: "Todo" },
];
const TZ_MS = 5 * 3_600_000; // días según la hora de Colombia (UTC−5)

/** Convierte el periodo elegido (o un rango propio desde/hasta) en fechas ISO [since, until). */
function periodRange(period: string, from?: string, to?: string): { since: string; until?: string } {
  const day = 86_400_000;
  const startOf = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + TZ_MS).toISOString();
  if (period === "custom" && from) return { since: startOf(from), until: to ? new Date(Date.parse(startOf(to)) + day).toISOString() : undefined };
  const local = new Date(Date.now() - TZ_MS);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  const today = Date.UTC(y, m, local.getUTCDate()) + TZ_MS;
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (period) {
    case "today": return { since: iso(today) };
    case "yesterday": return { since: iso(today - day), until: iso(today) };
    case "month": return { since: iso(Date.UTC(y, m, 1) + TZ_MS) };
    case "lastmonth": return { since: iso(Date.UTC(y, m - 1, 1) + TZ_MS), until: iso(Date.UTC(y, m, 1) + TZ_MS) };
    case "year": return { since: iso(Date.UTC(y, 0, 1) + TZ_MS) };
    case "all": return { since: "2000-01-01" };
    default: return { since: iso(today - (Number(period) - 1) * day) };
  }
}
const KIND_LABEL: Record<string, string> = { connection: "Conexión", inventory: "Inventario FBA", finances: "Ventas y fees", payouts: "Pagos de Amazon" };

type Ev = { event_type: string; posted_date: string; sku: string | null; quantity: number | null; principal: number; shipping: number;
  promotion: number; fba_fee: number; referral_fee: number; other_fees: number; total: number; description: string | null };

export default async function Amazon({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { tab = "pedidos", from = "", to = "" } = sp;
  const period = sp.period ?? (tab === "pedidos" ? "month" : "30");
  const supabase = await createClient();
  const { since, until } = periodRange(period, from, to);
  const ordersSince = [since, periodRange("lastmonth").since].sort()[0];
  const periodQs = period === "custom" ? `period=custom&from=${from}&to=${to}` : `period=${period}`;

  const [{ data: orders }, { data: runs }, { data: listings }, { data: inv }, { data: events }, { data: products }, { data: stock }, { data: fbaMoves }, { data: state }, { data: payouts }, { data: bankAmazon }] = await Promise.all([
    tab === "pedidos"
      ? supabase.from("amazon_orders").select("order_id, purchase_date, status, items, items_synced").gte("purchase_date", ordersSince).order("purchase_date").limit(5000)
      : Promise.resolve({ data: [] }),
    supabase.from("amazon_sync_runs").select("kind, status, message, started_at, finished_at").order("started_at", { ascending: false }).limit(30),
    supabase.from("amazon_listings").select("sku, asin, fnsku, title, product_id").order("title"),
    supabase.from("amazon_inventory").select("*"),
    allEvents(supabase, since, until),
    supabase.from("products").select("id, description, image_url, active").order("description"),
    supabase.from("v_inventory_on_hand").select("product_id, fba_unit_cost"),
    supabase.from("inventory_movements").select("product_id, qty").eq("location", "amazon_fba"),
    supabase.from("amazon_sync_state").select("value").eq("key", "finances").maybeSingle(),
    supabase.from("amazon_payouts").select("group_id, processing_status, fund_transfer_status, period_start, period_end, fund_transfer_date, amount, account_tail, bank:bank_transactions(txn_date, description, amount)").order("period_end", { ascending: false }),
    supabase.from("bank_transactions").select("id, txn_date, description, amount, counterparties!inner(name)").eq("counterparties.name", "Amazon").order("txn_date", { ascending: false }),
  ]);

  const missing = missingCredentials();
  const lastBy = (k: string) => (runs ?? []).find((r) => r.kind === k);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const productOfSku = new Map((listings ?? []).map((l) => [l.sku, l.product_id as string | null]));
  const costOf = new Map((stock ?? []).map((s) => [s.product_id, Number(s.fba_unit_cost ?? 0)]));
  const evs = (events ?? []) as Ev[];
  const unlinked = (listings ?? []).filter((l) => !l.product_id);
  // Pistas para vincular SKUs sin título: ventas, precio promedio y fechas (de todo el historial).
  const skuStats = new Map<string, { sold: number; revenue: number; first: string; last: string }>();
  for (const e of (tab === "skus" ? (await allEvents(supabase, "2000-01-01")).data : []) as Ev[]) {
    if (!e.sku || e.event_type !== "shipment") continue;
    const st = skuStats.get(e.sku) ?? { sold: 0, revenue: 0, first: e.posted_date, last: e.posted_date };
    st.sold += Number(e.quantity ?? 0);
    st.revenue += Number(e.principal) + Number(e.shipping) + Number(e.promotion);
    if (e.posted_date < st.first) st.first = e.posted_date;
    if (e.posted_date > st.last) st.last = e.posted_date;
    skuStats.set(e.sku, st);
  }
  const finState = state?.value as { done_until?: string } | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Amazon</h1>
        <p className="muted text-sm">Datos de tu cuenta de Seller Central vía SP-API: inventario FBA, ventas, fees, devoluciones y reembolsos.</p>
      </div>

      {missing.length > 0 && (
        <div className="card p-4 text-sm neg flex gap-2"><AlertTriangle size={18} /> Faltan variables en Vercel: {missing.join(", ")}. Agrégalas y vuelve a publicar.</div>
      )}

      <section className="card p-5 space-y-4">
        <SyncButtons />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(["connection", "inventory", "finances", "payouts"] as const).map((k) => {
            const r = lastBy(k);
            return (
              <div key={k} className="rounded-lg p-3 text-sm" style={{ background: "var(--bg)" }}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{KIND_LABEL[k]}</span>
                  {r ? <Badge tone={r.status === "ok" ? "pos" : r.status === "error" ? "neg" : "warn"}>{r.status === "ok" ? "OK" : r.status === "error" ? "Error" : r.status === "partial" ? "Parcial" : "En curso"}</Badge> : <Badge>Sin ejecutar</Badge>}
                </div>
                {r && <div className="muted text-xs mt-1">{new Date(r.started_at).toLocaleString("es-CO")}</div>}
                {r?.message && <div className={`text-xs mt-1 ${r.status === "error" ? "neg" : "muted"}`}>{r.message}</div>}
                {k === "finances" && finState?.done_until && <div className="muted text-xs mt-1">Datos hasta {date(finState.done_until.slice(0, 10))}</div>}
              </div>
            );
          })}
        </div>
        {unlinked.length > 0 && (
          <p className="text-sm flex items-center gap-2" style={{ color: "var(--warn)" }}>
            <AlertTriangle size={16} /> {unlinked.length} SKU(s) sin vincular a un producto. <Link href="/amazon?tab=skus" className="link">Vincularlos</Link>
          </p>
        )}
      </section>

      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/amazon?tab=${t.key}&${periodQs}`} className="px-4 py-2 text-sm -mb-px border-b-2 whitespace-nowrap"
            style={tab === t.key ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "transparent", color: "var(--muted)" }}>
            {t.label}
          </Link>
        ))}
      </div>

      {(tab === "rentabilidad" || tab === "cargos" || tab === "pedidos") && (
        <div className="flex flex-wrap gap-2 text-sm items-center">
          {PERIODS.map((p) => (
            <Link key={p.key} href={`/amazon?tab=${tab}&period=${p.key}`} className="rounded-full px-3 py-1 border"
              style={{ borderColor: "var(--border)", fontWeight: period === p.key ? 600 : 400, background: period === p.key ? "var(--accent-soft)" : undefined }}>
              {p.label}
            </Link>
          ))}
          <form className="flex flex-wrap gap-2 items-center">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="period" value="custom" />
            <input type="date" name="from" defaultValue={from} className="input w-auto py-1" aria-label="Desde" required />
            <span className="muted">a</span>
            <input type="date" name="to" defaultValue={to} className="input w-auto py-1" aria-label="Hasta" />
            <button className="btn-ghost py-1" style={period === "custom" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>Aplicar</button>
          </form>
        </div>
      )}
      {(tab === "rentabilidad" || tab === "cargos") && ["today", "yesterday"].includes(period) && (
        <p className="muted text-xs">Amazon registra la venta cuando envía el pedido (no cuando el cliente compra), así que “Hoy” puede ser menor que lo que ves en Seller Central.</p>
      )}

      {tab === "pedidos" && (
        <AmazonOrders orders={(orders ?? []) as OrderRow[]} since={since} until={until} fees={tab === "pedidos" ? await orderFees(supabase, since) : { byOrder: new Map(), perUnit: new Map() }}
          costOfSku={(sku) => costOf.get(productOfSku.get(sku) ?? "") ?? 0}
          nameOf={(sku, title) => productById.get(productOfSku.get(sku) ?? "")?.description ?? title?.slice(0, 60) ?? sku} />
      )}
      {tab === "rentabilidad" && <Profitability evs={evs} productOfSku={productOfSku} productById={productById} costOf={costOf} />}
      {tab === "cargos" && <AccountCharges evs={evs} />}
      {tab === "pagos" && <Payouts payouts={(payouts ?? []) as unknown as PayoutRow[]} bank={(bankAmazon ?? []) as unknown as BankRow[]} />}
      {tab === "inventario" && (
        <FbaInventory listings={listings ?? []} inv={inv ?? []} productById={productById} fbaMoves={fbaMoves ?? []} />
      )}
      {tab === "skus" && (
        <section className="card overflow-x-auto">
          <table className="data min-w-[860px]">
            <thead><tr><th>SKU</th><th>ASIN</th><th>Título en Amazon</th><th className="num">Vendidas</th><th className="num">Precio prom.</th><th>Vendió entre</th><th>Producto en AnyGoods</th></tr></thead>
            <tbody>
              {(listings ?? []).map((l) => (
                <tr key={l.sku}>
                  <td className="font-mono text-xs">{l.sku}</td>
                  <td className="muted">{l.asin ?? "—"}</td>
                  <td className="max-w-[360px]">{l.title ?? <span className="muted">—</span>}</td>
                  {(() => {
                    const st = skuStats.get(l.sku);
                    return st ? (
                      <>
                        <td className="num">{st.sold}</td>
                        <td className="num">{money(st.sold ? st.revenue / st.sold : 0)}</td>
                        <td className="whitespace-nowrap text-xs">{date(st.first.slice(0, 10))} – {date(st.last.slice(0, 10))}</td>
                      </>
                    ) : <><td className="num muted">0</td><td /><td /></>;
                  })()}
                  <td><LinkSelect sku={l.sku} productId={l.product_id} products={(products ?? []).map((p) => ({ id: p.id, description: p.description }))} /></td>
                </tr>
              ))}
              {(listings ?? []).length === 0 && <tr><td colSpan={7} className="muted">Sincroniza el inventario FBA para ver tus SKUs.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Profitability({ evs, productOfSku, productById, costOf }: {
  evs: Ev[]; productOfSku: Map<string, string | null>;
  productById: Map<string, { id: string; description: string; image_url: string | null }>; costOf: Map<string, number>;
}) {
  type Agg = { key: string; name: string; productId: string | null; sold: number; refunded: number; revenue: number; fba: number; referral: number; other: number; reimb: number; net: number };
  const agg = new Map<string, Agg>();
  for (const e of evs) {
    if (!e.sku || !["shipment", "refund", "adjustment"].includes(e.event_type)) continue;
    const pid = productOfSku.get(e.sku) ?? null;
    const key = pid ?? `sku:${e.sku}`;
    const a = agg.get(key) ?? { key, name: pid ? productById.get(pid)?.description ?? e.sku : `SKU ${e.sku} (sin vincular)`, productId: pid,
      sold: 0, refunded: 0, revenue: 0, fba: 0, referral: 0, other: 0, reimb: 0, net: 0 };
    if (e.event_type === "shipment") a.sold += e.quantity ?? 0;
    if (e.event_type === "refund") a.refunded += e.quantity ?? 0;
    if (e.event_type === "adjustment") a.reimb += Number(e.total);
    a.revenue += Number(e.principal) + Number(e.shipping) + Number(e.promotion);
    a.fba += Number(e.fba_fee);
    a.referral += Number(e.referral_fee);
    a.other += Number(e.other_fees);
    a.net += Number(e.total);
    agg.set(key, a);
  }
  const rows = [...agg.values()].map((a) => {
    const unitCost = a.productId ? costOf.get(a.productId) ?? 0 : 0;
    const netUnits = a.sold - a.refunded;
    const cost = netUnits * unitCost;
    const profit = a.net - cost;
    return { ...a, unitCost, netUnits, cost, profit, margin: a.revenue ? profit / a.revenue : 0, roi: cost ? profit / cost : 0 };
  }).sort((x, y) => y.revenue - x.revenue);
  const t = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, net: s.net + r.net, cost: s.cost + r.cost, profit: s.profit + r.profit, units: s.units + r.netUnits }),
    { revenue: 0, net: 0, cost: 0, profit: 0, units: 0 });
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="card p-4"><div className="muted text-xs uppercase">Unidades vendidas (netas)</div><div className="text-2xl font-semibold mt-1">{units(t.units)}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Ventas</div><div className="text-2xl font-semibold mt-1">{money(t.revenue)}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Neto de Amazon</div><div className="text-2xl font-semibold mt-1">{money(t.net)}</div><div className="muted text-xs">después de fees y devoluciones</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Costo de lo vendido</div><div className="text-2xl font-semibold mt-1">{money(t.cost)}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Utilidad bruta</div><div className={`text-2xl font-semibold mt-1 ${t.profit < 0 ? "neg" : "pos"}`}>{money(t.profit)}</div><div className="muted text-xs">{t.revenue ? `${pct(t.profit / t.revenue)} margen` : ""}</div></div>
      </section>
      <section className="card overflow-x-auto">
        <table className="data min-w-[1150px]">
          <thead>
            <tr>
              <th>Producto</th><th className="num">Vendidas</th><th className="num">Devueltas</th><th className="num">Ventas</th>
              <th className="num">Fee FBA</th><th className="num">Comisión</th><th className="num">Otros</th><th className="num">Reembolsos</th>
              <th className="num">Neto Amazon</th><th className="num">Costo neto/u</th><th className="num">Costo vendido</th>
              <th className="num">Utilidad</th><th className="num">Margen</th><th className="num">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.productId ? <Link href={`/productos/${r.productId}`} className="link">{r.name}</Link> : <span style={{ color: "var(--warn)" }}>{r.name}</span>}</td>
                <td className="num">{units(r.sold)}</td>
                <td className="num">{r.refunded ? units(r.refunded) : "—"}</td>
                <td className="num">{money(r.revenue)}</td>
                <td className="num neg">{money(r.fba)}</td>
                <td className="num neg">{money(r.referral)}</td>
                <td className="num">{r.other ? money(r.other) : "—"}</td>
                <td className="num pos">{r.reimb ? money(r.reimb) : "—"}</td>
                <td className="num font-medium">{money(r.net)}</td>
                <td className="num">{r.unitCost ? money(r.unitCost) : <span className="muted">—</span>}</td>
                <td className="num">{money(r.cost)}</td>
                <td className={`num font-semibold ${r.profit < 0 ? "neg" : "pos"}`}>{money(r.profit)}</td>
                <td className="num">{r.revenue ? pct(r.margin) : "—"}</td>
                <td className="num">{r.cost ? pct(r.roi) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={14} className="muted">Sin ventas en este periodo. Sincroniza ventas y fees.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="muted text-xs">Utilidad = neto que Amazon acredita (ventas − fees − devoluciones + reembolsos) − costo neto en Amazon de las unidades vendidas (compra + costos del proveedor + envío FBA). No incluye cargos de la cuenta (suscripción, almacenamiento, publicidad): ver la pestaña Cargos de la cuenta.</p>
    </div>
  );
}

function AccountCharges({ evs }: { evs: Ev[] }) {
  const rows = evs.filter((e) => e.event_type === "service_fee" || (e.event_type === "adjustment" && !e.sku) || e.event_type === "other");
  const byDesc = new Map<string, number>();
  for (const e of rows) byDesc.set(e.description ?? e.event_type, (byDesc.get(e.description ?? e.event_type) ?? 0) + Number(e.total));
  const total = [...byDesc.values()].reduce((a, v) => a + v, 0);
  return (
    <section className="card overflow-x-auto">
      <h2 className="font-semibold px-4 pt-4">Cargos y ajustes de la cuenta</h2>
      <p className="muted text-xs px-4">Suscripción, almacenamiento, publicidad, cargos de envío y otros ajustes que no son de un producto.</p>
      <table className="data mt-2">
        <thead><tr><th>Concepto</th><th className="num">Total</th></tr></thead>
        <tbody>
          {[...byDesc.entries()].sort((a, b) => a[1] - b[1]).map(([d, v]) => (
            <tr key={d}><td>{d}</td><td className={`num ${v < 0 ? "neg" : "pos"}`}>{money(v)}</td></tr>
          ))}
          {byDesc.size === 0 && <tr><td colSpan={2} className="muted">Sin cargos en este periodo.</td></tr>}
        </tbody>
        {byDesc.size > 0 && <tfoot><tr className="font-semibold"><td>Total</td><td className="num">{money(total)}</td></tr></tfoot>}
      </table>
    </section>
  );
}

function FbaInventory({ listings, inv, productById, fbaMoves }: {
  listings: { sku: string; asin: string | null; title: string | null; product_id: string | null }[];
  inv: { sku: string; fulfillable: number; inbound_working: number; inbound_shipped: number; inbound_receiving: number; reserved: number; unfulfillable: number; researching: number; synced_at: string }[];
  productById: Map<string, { id: string; description: string; image_url: string | null }>;
  fbaMoves: { product_id: string; qty: number }[];
}) {
  const invBySku = new Map(inv.map((i) => [i.sku, i]));
  const system = new Map<string, number>();
  for (const m of fbaMoves) system.set(m.product_id, (system.get(m.product_id) ?? 0) + m.qty);
  type Row = { key: string; productId: string | null; name: string; skus: string[]; fulfillable: number; inbound: number; reserved: number; unfulfillable: number; researching: number; onHand: number };
  const rows = new Map<string, Row>();
  for (const l of listings) {
    const i = invBySku.get(l.sku);
    if (!i) continue;
    const key = l.product_id ?? `sku:${l.sku}`;
    const r = rows.get(key) ?? { key, productId: l.product_id, name: l.product_id ? productById.get(l.product_id)?.description ?? l.sku : `${l.title ?? l.sku} (sin vincular)`,
      skus: [], fulfillable: 0, inbound: 0, reserved: 0, unfulfillable: 0, researching: 0, onHand: 0 };
    r.skus.push(l.sku);
    r.fulfillable += i.fulfillable;
    r.inbound += i.inbound_working + i.inbound_shipped + i.inbound_receiving;
    r.reserved += i.reserved;
    r.unfulfillable += i.unfulfillable;
    r.researching += i.researching;
    r.onHand += i.fulfillable + i.reserved + i.unfulfillable + i.researching;
    rows.set(key, r);
  }
  const list = [...rows.values()].sort((a, b) => b.onHand - a.onHand);
  const syncedAt = inv[0]?.synced_at;
  const diffs = list.filter((r) => r.productId && r.onHand !== (system.get(r.productId) ?? 0)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="muted text-sm">{syncedAt ? `Reportado por Amazon el ${new Date(syncedAt).toLocaleString("es-CO")}.` : "Sincroniza el inventario FBA."} {diffs ? `${diffs} producto(s) no coinciden con el sistema.` : ""}</p>
        {diffs > 0 && <ReconcileButton label="Cuadrar todo con Amazon" />}
      </div>
      <section className="card overflow-x-auto">
        <table className="data min-w-[1000px]">
          <thead>
            <tr>
              <th>Producto</th><th className="num">Disponible</th><th className="num">Reservado</th><th className="num">No vendible</th>
              <th className="num">En investigación</th><th className="num">En camino a Amazon</th><th className="num">En Amazon (total)</th>
              <th className="num">Sistema FBA</th><th className="num">Diferencia</th><th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const sys = r.productId ? system.get(r.productId) ?? 0 : null;
              const diff = sys === null ? null : r.onHand - sys;
              return (
                <tr key={r.key}>
                  <td>
                    {r.productId ? <Link href={`/productos/${r.productId}`} className="link">{r.name}</Link> : <span style={{ color: "var(--warn)" }}>{r.name}</span>}
                    <div className="muted text-xs font-mono">{r.skus.join(", ")}</div>
                  </td>
                  <td className="num font-medium">{units(r.fulfillable)}</td>
                  <td className="num">{units(r.reserved)}</td>
                  <td className="num">{r.unfulfillable ? <span className="neg">{units(r.unfulfillable)}</span> : "0"}</td>
                  <td className="num">{units(r.researching)}</td>
                  <td className="num muted">{units(r.inbound)}</td>
                  <td className="num font-semibold">{units(r.onHand)}</td>
                  <td className="num">{sys === null ? "—" : units(sys)}</td>
                  <td className={`num ${diff ? (diff < 0 ? "neg" : "pos") : "muted"}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${units(diff)}`}</td>
                  <td>{r.productId && diff ? <ReconcileButton productId={r.productId} label="Cuadrar" /> : null}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={10} className="muted">Sin datos. Pulsa “Sincronizar inventario FBA”.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="muted text-xs">“En Amazon (total)” = disponible + reservado + no vendible + en investigación. Cuadrar registra la diferencia como venta en Amazon (si el sistema tiene más) o como ajuste (si Amazon tiene más). Lo que va en camino se gestiona en Envíos FBA.</p>
    </div>
  );
}

type PayoutRow = { group_id: string; processing_status: string | null; fund_transfer_status: string | null; period_start: string | null; period_end: string | null;
  fund_transfer_date: string | null; amount: number | null; account_tail: string | null; bank: { txn_date: string; description: string; amount: number } | null };
type BankRow = { id: string; txn_date: string; description: string; amount: number };

function Payouts({ payouts, bank }: { payouts: PayoutRow[]; bank: BankRow[] }) {
  const d = (v: string | null) => (v ? date(v.slice(0, 10)) : "—");
  const transferred = payouts.filter((p) => p.fund_transfer_status === "Succeeded" || p.fund_transfer_status === "Transferred");
  const totalAmazon = transferred.reduce((a, p) => a + Number(p.amount ?? 0), 0);
  const matched = payouts.filter((p) => p.bank);
  const missing = transferred.filter((p) => !p.bank && Number(p.amount ?? 0) !== 0);
  const bankDeposits = bank.filter((b) => Number(b.amount) > 0).reduce((a, b) => a + Number(b.amount), 0);
  const bankCharges = bank.filter((b) => Number(b.amount) < 0).reduce((a, b) => a + Number(b.amount), 0);
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4"><div className="muted text-xs uppercase">Transferido por Amazon</div><div className="text-2xl font-semibold mt-1">{money(totalAmazon)}</div><div className="muted text-xs">{transferred.length} liquidaciones</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Depósitos Amazon en Mercury</div><div className="text-2xl font-semibold mt-1">{money(bankDeposits)}</div><div className="muted text-xs">cargos de Amazon al banco: {money(bankCharges)}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Cruzadas con el banco</div><div className="text-2xl font-semibold mt-1 pos">{matched.length}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase">Sin encontrar en el banco</div><div className={`text-2xl font-semibold mt-1 ${missing.length ? "neg" : ""}`}>{missing.length}</div><div className="muted text-xs">{money(missing.reduce((a, p) => a + Number(p.amount ?? 0), 0))}</div></div>
      </section>
      <section className="card overflow-x-auto">
        <table className="data min-w-[900px]">
          <thead><tr><th>Periodo</th><th>Transferencia</th><th>Estado</th><th>Cuenta</th><th className="num">Monto Amazon</th><th>Movimiento en Mercury</th></tr></thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.group_id}>
                <td className="whitespace-nowrap">{d(p.period_start)} – {d(p.period_end)}</td>
                <td className="whitespace-nowrap">{d(p.fund_transfer_date)}</td>
                <td>
                  {p.processing_status === "Open" ? <Badge tone="warn">Abierta (en curso)</Badge>
                    : p.fund_transfer_status === "Succeeded" || p.fund_transfer_status === "Transferred" ? <Badge tone="pos">Transferida</Badge>
                    : <Badge>{p.fund_transfer_status ?? p.processing_status ?? "—"}</Badge>}
                </td>
                <td className="muted">{p.account_tail ? `••${p.account_tail}` : "—"}</td>
                <td className={`num font-medium ${Number(p.amount) < 0 ? "neg" : ""}`}>{money(p.amount)}</td>
                <td>
                  {p.bank ? <span className="pos text-sm">✓ {date(p.bank.txn_date)} · {money(p.bank.amount)}</span>
                    : p.processing_status === "Open" ? <span className="muted text-sm">Aún no se transfiere</span>
                    : Number(p.amount ?? 0) === 0 ? <span className="muted text-sm">Sin monto</span>
                    : <span className="neg text-sm">No encontrado en el banco</span>}
                </td>
              </tr>
            ))}
            {payouts.length === 0 && <tr><td colSpan={6} className="muted">Sincroniza ventas, fees y pagos.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="muted text-xs">Cada liquidación se cruza con el movimiento de Amazon en Mercury del mismo monto (hasta 10 días después). Las liquidaciones negativas son cargos de Amazon a tu tarjeta o cuenta cuando el saldo quedó en contra.</p>
    </div>
  );
}

/** Supabase devuelve máximo 1.000 filas por consulta: se pagina para traer todo el historial. */
async function allEvents(supabase: Awaited<ReturnType<typeof createClient>>, since: string, until?: string) {
  const rows: Ev[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("amazon_financial_events")
      .select("event_type, posted_date, sku, quantity, principal, shipping, promotion, fba_fee, referral_fee, other_fees, total, description")
      .gte("posted_date", since);
    if (until) q = q.lt("posted_date", until);
    const { data, error } = await q.order("posted_date").order("id").range(from, from + 999);
    if (error) return { data: rows, error };
    rows.push(...((data ?? []) as Ev[]));
    if ((data ?? []).length < 1000) return { data: rows, error: null };
  }
}

/** Fees reales por pedido ya despachado y fee promedio por unidad de cada SKU (últimos 90 días) para estimar pendientes. */
async function orderFees(supabase: Awaited<ReturnType<typeof createClient>>, since: string): Promise<OrderFees> {
  const from90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const start = since < from90 ? since : from90;
  const rows: { order_id: string | null; sku: string | null; quantity: number | null; fba_fee: number; referral_fee: number; other_fees: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("amazon_financial_events").select("order_id, sku, quantity, fba_fee, referral_fee, other_fees")
      .eq("event_type", "shipment").gte("posted_date", start).order("id").range(from, from + 999);
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < 1000) break;
  }
  const byOrder = new Map<string, number>();
  const per = new Map<string, { fee: number; qty: number }>();
  for (const r of rows) {
    const fee = -(Number(r.fba_fee) + Number(r.referral_fee) + Number(r.other_fees));
    if (r.order_id) byOrder.set(r.order_id, (byOrder.get(r.order_id) ?? 0) + fee);
    if (r.sku && r.quantity) {
      const p = per.get(r.sku) ?? { fee: 0, qty: 0 };
      p.fee += fee; p.qty += r.quantity; per.set(r.sku, p);
    }
  }
  return { byOrder, perUnit: new Map([...per].map(([sku, p]) => [sku, p.qty ? p.fee / p.qty : 0])) };
}
