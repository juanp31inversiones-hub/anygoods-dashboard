import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Ev = { event_type: string; posted_date: string; sku: string | null; quantity: number | null;
  principal: number; shipping: number; promotion: number; total: number; description: string | null };

export type Pnl = {
  sales: number;          // lo que pagaron los clientes
  keptByAmazon: number;   // comisiones, fees FBA y devoluciones de clientes
  reimbursed: number;     // Amazon pagó por unidades perdidas o dañadas
  cogs: number;           // costo de los productos vendidos
  productProfit: number;  // ganancia de los productos
  removals: number;       // retiros y eliminación de inventario
  otherCharges: number;   // envío a Amazon, almacenamiento, suscripción, etiquetas, publicidad
  result: number;         // resultado total en Amazon
  units: number;
};

const REMOVAL = /removal|disposal/i;

/** Estado de resultados de Amazon desde los eventos financieros, con el costo de cada producto vendido. */
export async function amazonPnl(supabase: Supabase, since?: string): Promise<Pnl> {
  const evs: Ev[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("amazon_financial_events")
      .select("event_type, posted_date, sku, quantity, principal, shipping, promotion, total, description")
      .order("id").range(from, from + 999);
    if (since) q = q.gte("posted_date", since);
    const { data } = await q;
    evs.push(...((data ?? []) as Ev[]));
    if ((data ?? []).length < 1000) break;
  }
  const [{ data: listings }, { data: lines }, { data: extras }] = await Promise.all([
    supabase.from("amazon_listings").select("sku, product_id").not("product_id", "is", null),
    supabase.from("purchase_order_lines").select("id, product_id, units, unit_cost"),
    supabase.from("v_line_costs").select("line_id, amount"),
  ]);
  const productOf = new Map((listings ?? []).map((l) => [l.sku, l.product_id as string]));
  const extraOf = new Map<string, number>();
  for (const x of extras ?? []) extraOf.set(x.line_id, (extraOf.get(x.line_id) ?? 0) + Number(x.amount));
  const agg = new Map<string, { cost: number; units: number }>();
  for (const l of lines ?? []) {
    const a = agg.get(l.product_id) ?? { cost: 0, units: 0 };
    a.cost += l.units * Number(l.unit_cost) + (extraOf.get(l.id) ?? 0);
    a.units += l.units;
    agg.set(l.product_id, a);
  }
  const unitCost = (sku: string | null) => {
    const a = sku ? agg.get(productOf.get(sku) ?? "") : undefined;
    return a && a.units ? a.cost / a.units : 0;
  };

  const p: Pnl = { sales: 0, keptByAmazon: 0, reimbursed: 0, cogs: 0, productProfit: 0, removals: 0, otherCharges: 0, result: 0, units: 0 };
  for (const e of evs) {
    const total = Number(e.total);
    if (e.event_type === "shipment" || e.event_type === "refund") {
      const gross = Number(e.principal) + Number(e.shipping) + Number(e.promotion);
      const sign = e.event_type === "shipment" ? 1 : -1;
      if (sign > 0) p.sales += gross;
      p.keptByAmazon += (sign > 0 ? gross : 0) - total;
      const q = sign * Number(e.quantity ?? 0);
      p.units += q;
      p.cogs += q * unitCost(e.sku);
    } else if (e.sku) {
      p.reimbursed += total;
    } else if (REMOVAL.test(e.description ?? "")) {
      p.removals -= total;
    } else {
      p.otherCharges -= total;
    }
  }
  p.productProfit = p.sales - p.keptByAmazon + p.reimbursed - p.cogs;
  p.result = p.productProfit - p.removals - p.otherCharges;
  return p;
}
