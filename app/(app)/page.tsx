import { createClient } from "@/lib/supabase/server";
import { Stat } from "@/components/Stat";
import { CATEGORY_LABELS, money, pct, units } from "@/lib/format";
import Link from "next/link";
import { ClipboardCheck, Landmark, Send, ShoppingCart } from "lucide-react";

const INCOME = ["amazon_payout", "other_sales"];
const NON_OPERATING = ["capital_contribution", "capital_return", "transfer", "inventory"];

export default async function Dashboard() {
  const supabase = await createClient();
  const [txns, capital, monthly, inventory, agents] = await Promise.all([
    supabase.from("bank_transactions").select("amount, category"),
    supabase.from("v_partner_capital").select("*"),
    supabase.from("v_monthly_cashflow").select("*"),
    supabase.from("v_inventory_on_hand").select("units_on_hand, units_fba, units_other, inventory_value"),
    supabase.from("v_agent_balance").select("*"),
  ]);

  const rows = txns.data ?? [];
  const sum = (f: (r: { amount: number; category: string }) => boolean) =>
    rows.filter(f).reduce((a, r) => a + Number(r.amount), 0);

  const cash = sum(() => true);
  const contributed = sum((r) => r.category === "capital_contribution");
  const income = sum((r) => INCOME.includes(r.category));
  const opex = -sum((r) => Number(r.amount) < 0 && !NON_OPERATING.includes(r.category));
  const inventoryPaid = -sum((r) => r.category === "inventory");
  const operating = income - opex;

  const inv = inventory.data ?? [];
  const invValue = inv.reduce((a, r) => a + Number(r.inventory_value), 0);
  const invUnits = inv.reduce((a, r) => a + Number(r.units_on_hand), 0);
  const invOther = inv.reduce((a, r) => a + Number(r.units_other), 0);

  const byCategory = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + Number(r.amount);
      return acc;
    }, {}),
  ).sort((a, b) => a[1] - b[1]);

  const totalCapital = (capital.data ?? []).reduce((a, p) => a + Number(p.net_capital), 0);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Resumen</h1>
        <p className="muted text-sm">Basado en movimientos de Mercury y órdenes de compra registradas.</p>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: "/compras/nueva", label: "Nueva compra", hint: "Registrar una orden a proveedor", icon: ShoppingCart },
          { href: "/inventario/conteo", label: "Dar salida / conteo", hint: "Productos vendidos o que ya no tienes", icon: ClipboardCheck },
          { href: "/banco/nuevo", label: "Registrar pago o ingreso", hint: "Movimiento en Mercury", icon: Landmark },
          { href: "/envios/nuevo", label: "Enviar a Amazon", hint: "Mover unidades de tu inventario a FBA", icon: Send },
        ].map(({ href, label, hint, icon: Icon }) => (
          <Link key={href} href={href} className="card p-4 flex gap-3 items-start hover:shadow-sm transition-shadow">
            <span className="rounded-lg p-2" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icon size={20} /></span>
            <span>
              <span className="block font-medium text-sm">{label}</span>
              <span className="block muted text-xs mt-0.5">{hint}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Caja Mercury (calculada)" value={money(cash)} hint="Compárala con el saldo real del banco" />
        <Stat label="Capital aportado" value={money(contributed)} hint="Aportes netos de los 4 socios" />
        <Stat label="Inventario a costo" value={money(invValue)} hint={`${units(invUnits)} und · ${units(invOther)} fuera de FBA · sin descontar ventas`} />
        <Stat label="Resultado operativo (caja)" value={money(operating)} tone={operating < 0 ? "neg" : "pos"} hint="Ingresos − gastos, sin inventario ni aportes" />
      </section>

      <section className="grid lg:grid-cols-3 gap-3">
        <Stat label="Ingresos operativos" value={money(income)} hint="Pagos Amazon + otras ventas" />
        <Stat label="Gastos operativos" value={money(opex)} hint="Cargos Amazon, herramientas, legal, fees" tone="neg" />
        <Stat label="Pagado en inventario" value={money(inventoryPaid)} hint="Incluye depósito a EC Access" />
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card overflow-x-auto">
          <h2 className="font-semibold px-4 pt-4">Capital por socio</h2>
          <table className="data mt-2">
            <thead>
              <tr><th>Socio</th><th className="num">% propiedad</th><th className="num">Aportado</th><th className="num">% del capital</th></tr>
            </thead>
            <tbody>
              {(capital.data ?? []).map((p) => {
                const share = totalCapital ? Number(p.net_capital) / totalCapital : 0;
                const gap = share - Number(p.ownership_pct);
                return (
                  <tr key={p.short_name}>
                    <td>{p.short_name}</td>
                    <td className="num">{pct(Number(p.ownership_pct))}</td>
                    <td className="num">{money(p.net_capital)}</td>
                    <td className={`num ${Math.abs(gap) > 0.01 ? (gap > 0 ? "pos" : "neg") : ""}`}>{pct(share)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card overflow-x-auto">
          <h2 className="font-semibold px-4 pt-4">Movimientos por categoría</h2>
          <table className="data mt-2">
            <thead><tr><th>Categoría</th><th className="num">Total</th></tr></thead>
            <tbody>
              {byCategory.map(([cat, total]) => (
                <tr key={cat}>
                  <td>{CATEGORY_LABELS[cat] ?? cat}</td>
                  <td className={`num ${total < 0 ? "neg" : "pos"}`}>{money(total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {(agents.data ?? []).length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="font-semibold px-4 pt-4">Dinero nuestro en manos de terceros</h2>
          <p className="muted text-xs px-4">Depositado + cobrado a nuestro favor − pagado por nosotros − devuelto = lo que el tercero aún tiene nuestro.</p>
          <table className="data mt-2">
            <thead>
              <tr><th>Tercero</th><th className="num">Depositado</th><th className="num">+ Cobrado a favor</th><th className="num">− Pagado por nosotros</th><th className="num">− Devuelto</th><th className="num">= Saldo que tienen</th></tr>
            </thead>
            <tbody>
              {(agents.data ?? []).map((a) => {
                const balance = Number(a.deposited) + Number(a.collected_for_us ?? 0) - Number(a.spent_on_purchases) - Number(a.returned_to_us ?? 0);
                return (
                  <tr key={a.agent}>
                    <td><Link href={`/proveedores/${a.counterparty_id}`} className="link">{a.agent}</Link></td>
                    <td className="num">{money(a.deposited)}</td>
                    <td className="num">{money(a.collected_for_us)}</td>
                    <td className="num">{money(a.spent_on_purchases)}</td>
                    <td className="num">{money(a.returned_to_us)}</td>
                    <td className={`num font-semibold ${balance > 1 ? "neg" : ""}`}>{money(balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Flujo de caja mensual</h2>
        <table className="data mt-2">
          <thead>
            <tr><th>Mes</th><th className="num">Ingresos operativos</th><th className="num">Egresos (sin aportes)</th><th className="num">Aportes netos</th><th className="num">Cambio en caja</th></tr>
          </thead>
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
      </section>
    </div>
  );
}
