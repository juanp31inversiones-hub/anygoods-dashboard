import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { amazonPnl, type Pnl } from "@/lib/amazonPnl";
import { CATEGORY_LABELS, money, pct, units } from "@/lib/format";
import { ReconcileButton } from "@/components/AmazonControls";
import { ProductFlow, type FlowMove } from "@/components/ProductFlow";
import { stockByLocation } from "@/lib/stock";

export const maxDuration = 60;

const GUIDE = [
  { href: "/amazon", label: "Amazon", use: "Ventas, cargos y pagos de Amazon. Usa “Sincronizar todo” una vez por semana." },
  { href: "/inventario", label: "Inventario", use: "Cuántas unidades tienes y dónde están (Amazon, proveedor, bodega)." },
  { href: "/envios", label: "Envíos a Amazon", use: "Crea el envío en Seller Central y tráelo aquí con un clic; la app lo sigue sola." },
  { href: "/compras", label: "Compras", use: "Cada orden a un proveedor: costo, pagos y documentos." },
  { href: "/banco", label: "Banco", use: "Entradas, salidas y saldo de Mercury, con filtro por fechas y categoría." },
  { href: "/productos", label: "Productos", use: "Catálogo con foto y costo de cada producto." },
  { href: "/proveedores", label: "Proveedores", use: "Proveedores, clientes y terceros como EC Access." },
];

export default async function Dashboard() {
  const supabase = await createClient();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [txns, capital, monthly, onHand, agents, amzInv, listings, openPayouts, poStatus, pnlAll, pnl30, stock, flowMoves] = await Promise.all([
    supabase.from("bank_transactions").select("amount, category"),
    supabase.from("v_partner_capital").select("*"),
    supabase.from("v_monthly_cashflow").select("*"),
    supabase.from("v_inventory_on_hand").select("product_id, description, image_url, units_fba, units_other, avg_cost, fba_unit_cost").neq("units_on_hand", 0),
    supabase.from("v_agent_balance").select("*"),
    supabase.from("amazon_inventory").select("sku, fulfillable, reserved, unfulfillable, researching"),
    supabase.from("amazon_listings").select("sku, product_id, products(description, image_url)").not("product_id", "is", null),
    supabase.from("amazon_payouts").select("amount").neq("processing_status", "Closed"),
    supabase.from("v_po_payment_status").select("total, paid"),
    amazonPnl(supabase),
    amazonPnl(supabase, since30),
    stockByLocation(supabase, false),
    supabase.from("inventory_movements").select("product_id, movement, qty, location, reference, notes"),
  ]);

  // Plata
  const rows = txns.data ?? [];
  const cash = rows.reduce((a, r) => a + Number(r.amount), 0);
  const amazonPending = (openPayouts.data ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const agentRows = (agents.data ?? []).map((a) => ({
    ...a, balance: Number(a.deposited) + Number(a.collected_for_us ?? 0) - Number(a.spent_on_purchases) - Number(a.returned_to_us ?? 0),
  }));
  const withAgents = agentRows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  const toPay = (poStatus.data ?? []).reduce((a, r) => a + Math.max(0, Number(r.total) - Number(r.paid)), 0);

  // Inventario: en Amazon se usa lo que Amazon reporta; fuera de Amazon, lo que lleva la app.
  type Inv = { id: string; name: string; image: string | null; amazon: number; amazonSystem: number; other: number; value: number };
  const invMap = new Map<string, Inv>();
  for (const r of onHand.data ?? []) {
    invMap.set(r.product_id, { id: r.product_id, name: r.description, image: r.image_url, amazon: 0, amazonSystem: Number(r.units_fba),
      other: Number(r.units_other), value: Number(r.units_other) * Number(r.avg_cost ?? 0) });
  }
  const amzBySku = new Map((amzInv.data ?? []).map((i) => [i.sku, i.fulfillable + i.reserved + i.unfulfillable + i.researching]));
  const unitCost = new Map((onHand.data ?? []).map((r) => [r.product_id, Number(r.fba_unit_cost ?? r.avg_cost ?? 0)]));
  for (const l of (listings.data ?? []) as unknown as { sku: string; product_id: string; products: { description: string; image_url: string | null } | null }[]) {
    const n = amzBySku.get(l.sku) ?? 0;
    if (!n) continue;
    const inv = invMap.get(l.product_id) ?? { id: l.product_id, name: l.products?.description ?? l.sku, image: l.products?.image_url ?? null, amazon: 0, amazonSystem: 0, other: 0, value: 0 };
    inv.amazon += n;
    inv.value += n * (unitCost.get(l.product_id) ?? 0);
    invMap.set(l.product_id, inv);
  }
  const inventory = [...invMap.values()].filter((i) => i.amazon || i.other).sort((a, b) => b.value - a.value);
  const invValue = inventory.reduce((a, i) => a + i.value, 0);
  const total = cash + amazonPending + withAgents + invValue;

  // Pendientes
  type Todo = { text: string; detail: string; href?: string; action?: "reconcile" };
  const todos: Todo[] = [];
  if (pnl30.removals > 0) todos.push({ text: `Amazon te cobró ${money(pnl30.removals)} en retiros de inventario en los últimos 30 días.`,
    detail: "Apaga el retiro automático: Seller Central → Settings → Fulfillment by Amazon → Automated unfulfillable removal → Disable." });
  const fbaDiff = inventory.filter((i) => i.amazon !== i.amazonSystem);
  if (fbaDiff.length) todos.push({ text: `El inventario en Amazon no coincide con la app (${fbaDiff.map((i) => `${i.name.split(" ").slice(0, 3).join(" ")}: app ${i.amazonSystem}, Amazon ${i.amazon}`).join("; ")}).`,
    detail: "Pulsa “Cuadrar con Amazon”: registra las ventas y marca los faltantes que puedes reclamar.", action: "reconcile" });
  for (const a of agentRows.filter((r) => r.balance > 1)) todos.push({ text: `${a.agent} tiene ${money(a.balance)} tuyos.`,
    detail: "Pídeles un estado de cuenta (dinero e inventario) y que te devuelvan el saldo.", href: `/proveedores/${a.counterparty_id}` });
  if (toPay > 0.01) todos.push({ text: `Tienes ${money(toPay)} por pagar a proveedores.`, detail: "Revisa las compras con saldo.", href: "/compras" });

  return (
    <div className="space-y-8 max-w-5xl">
      <section>
        <h1 className="text-xl md:text-2xl font-semibold">Así va AnyGoods</h1>
        <p className="muted text-sm">Resumen en lenguaje simple. Los datos de Amazon se actualizan con “Sincronizar todo” en la página Amazon.</p>
      </section>

      {/* 1. Plata */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base md:text-lg">1. ¿Cuánto vale hoy la empresa?</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card label="En el banco (Mercury)" value={money(cash)} hint="Debe coincidir con tu saldo real" />
          <Card label="Amazon te debe" value={money(amazonPending)} hint="Llega en el próximo pago" />
          <Card label="En manos de terceros" value={money(withAgents)} hint={agentRows.filter((a) => a.balance > 1).map((a) => a.agent).join(", ") || "Nadie"} />
          <Card label="Inventario (a costo)" value={money(invValue)} hint={`${units(inventory.reduce((a, i) => a + i.amazon + i.other, 0))} unidades`} />
        </div>
        <div className="card p-4 flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">Total: plata + inventario</span>
          <span className="text-2xl font-semibold tabular-nums">{money(total)}</span>
          {toPay > 0.01 && <span className="muted text-xs w-full">Menos {money(toPay)} que aún debes a proveedores.</span>}
        </div>
      </section>

      {/* 2. Ganancia */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base md:text-lg">2. ¿Estamos ganando o perdiendo en Amazon?</h2>
        <div className="grid lg:grid-cols-2 gap-3">
          <PnlCard title="Últimos 30 días" p={pnl30} />
          <PnlCard title="Desde el inicio (may-2025)" p={pnlAll} />
        </div>
      </section>

      {/* 3. Inventario */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base md:text-lg">3. ¿Qué pasó con lo que compramos?</h2>
        <p className="muted text-sm">Por producto: lo comprado, menos lo vendido y lo perdido, igual a lo que tienes hoy y dónde está.</p>
        <ProductFlow products={stock.filter((r) => Number(r.units_on_hand) > 0)} moves={(flowMoves.data ?? []) as FlowMove[]} />
      </section>

      {/* 4. Pendientes */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base md:text-lg">4. ¿Qué tengo que hacer?</h2>
        {todos.length === 0 ? (
          <div className="card p-4 flex items-center gap-2 pos"><CheckCircle2 size={18} /> Todo en orden.</div>
        ) : (
          <ol className="space-y-2">
            {todos.map((t, i) => (
              <li key={i} className="card p-4 flex gap-3">
                <span className="rounded-full w-6 h-6 shrink-0 flex items-center justify-center text-xs font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{i + 1}</span>
                <div className="space-y-1 flex-1">
                  <p className="font-medium text-sm flex gap-1.5"><AlertTriangle size={15} className="neg shrink-0 mt-0.5" />{t.text}</p>
                  <p className="muted text-sm">{t.detail}</p>
                  {t.action === "reconcile" && <ReconcileButton />}
                  {t.href && <Link href={t.href} className="link text-sm inline-flex items-center">Ir <ChevronRight size={14} /></Link>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Guía */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base md:text-lg">¿Para qué sirve cada sección?</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {GUIDE.map((g) => (
            <Link key={g.href} href={g.href} className="card p-3 hover:shadow-sm transition-shadow">
              <span className="font-medium text-sm">{g.label}</span>
              <span className="block muted text-xs mt-0.5">{g.use}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Detalle para socios */}
      <details className="card p-4">
        <summary className="font-medium cursor-pointer">Detalle financiero: capital por socio y flujo de caja mensual</summary>
        <div className="grid lg:grid-cols-2 gap-6 mt-4">
          <table className="data">
            <thead><tr><th>Socio</th><th className="num">% propiedad</th><th className="num">Aportado</th></tr></thead>
            <tbody>
              {(capital.data ?? []).map((p) => (
                <tr key={p.short_name}><td>{p.short_name}</td><td className="num">{pct(Number(p.ownership_pct))}</td><td className="num">{money(p.net_capital)}</td></tr>
              ))}
            </tbody>
          </table>
          <table className="data">
            <thead><tr><th>Categoría del banco</th><th className="num">Total</th></tr></thead>
            <tbody>
              {Object.entries(rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + Number(r.amount) }), {}))
                .sort((a, b) => a[1] - b[1]).map(([cat, t]) => (
                  <tr key={cat}><td>{CATEGORY_LABELS[cat] ?? cat}</td><td className={`num ${t < 0 ? "neg" : "pos"}`}>{money(t)}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
        <table className="data mt-6">
          <thead><tr><th>Mes</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Aportes</th><th className="num">Cambio en caja</th></tr></thead>
          <tbody>
            {(monthly.data ?? []).slice().reverse().map((m) => (
              <tr key={m.month}>
                <td>{new Date(m.month + "T00:00:00").toLocaleDateString("es-CO", { month: "short", year: "numeric" })}</td>
                <td className="num">{money(m.operating_income)}</td>
                <td className="num neg">{money(m.operating_expenses)}</td>
                <td className="num">{money(m.net_capital_flow)}</td>
                <td className={`num ${Number(m.net_cash_change) < 0 ? "neg" : "pos"}`}>{money(m.net_cash_change)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="muted text-xs">{label}</div>
      <div className="text-lg md:text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="muted text-xs mt-1 line-clamp-1">{hint}</div>}
    </div>
  );
}

function PnlCard({ title, p }: { title: string; p: Pnl }) {
  const line = (label: string, v: number, sign: "+" | "−" | "=", hint?: string) => (
    <div className={`flex justify-between gap-3 py-2 border-b ${sign === "=" ? "font-semibold" : ""}`} style={{ borderColor: "var(--border)" }}>
      <span className={sign === "=" ? "" : "muted"}>
        {sign === "=" ? "" : `${sign} `}{label}
        {hint && <span className="block text-xs muted font-normal">{hint}</span>}
      </span>
      <span className={`tabular-nums whitespace-nowrap ${sign === "=" ? (v < 0 ? "neg" : "pos") : ""}`}>{money(v)}</span>
    </div>
  );
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">{title}</h3>
        <span className="muted text-xs">{units(p.units)} und vendidas</span>
      </div>
      <p className={`text-xl font-semibold mt-1 mb-2 ${p.result < 0 ? "neg" : "pos"}`}>
        {p.result < 0 ? `Perdiste ${money(-p.result)}` : `Ganaste ${money(p.result)}`}
      </p>
      <div className="text-sm">
        {line("Ventas", p.sales, "+")}
        {line("Amazon se quedó", p.keptByAmazon, "−", "Comisiones, fees FBA y devoluciones")}
        {p.reimbursed !== 0 && line("Amazon te reembolsó", p.reimbursed, "+", "Unidades perdidas o dañadas")}
        {line("Costo del producto", p.cogs, "−")}
        {line("Ganancia de los productos", p.productProfit, "=")}
        {p.removals !== 0 && line("Retiros de inventario", p.removals, "−")}
        {line("Otros cargos de Amazon", p.otherCharges, "−", "Envío a Amazon, almacenamiento, suscripción")}
        {line("Resultado", p.result, "=")}
      </div>
    </div>
  );
}
