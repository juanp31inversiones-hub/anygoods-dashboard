"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { savePurchaseOrder, type POCost, type POLine, type POPayload } from "@/lib/actions";
import { COST_TYPE_LABELS, LOCATION_LABELS, STATUS_LABELS, money } from "@/lib/format";
import { Field } from "@/components/ui";

type Option = { id: string; name: string };
type ProductOption = { id: string; description: string; units_per_case: number | null };

const EMPTY_LINE: POLine = { product_id: "", cases: "", units: "", unit_cost: "" };
/** Los descuentos se escriben en positivo y siempre restan. */
const signed = (c: POCost) => (c.cost_type === "supplier_discount" ? -Math.abs(Number(c.amount || 0)) : Number(c.amount || 0));

const emptyCost = (): POCost => ({ cost_type: "amazon_inbound", description: "", amount: "", product_id: "", allocation: "units", cost_date: "", counterparty_id: "" });

/** Reparte cada costo entre las líneas (igual que v_line_costs en la base de datos). */
export function allocateCosts(lines: POLine[], costs: POCost[]) {
  const perLine = lines.map(() => 0);
  for (const c of costs) {
    const amount = signed(c);
    if (!amount) continue;
    const idx = lines.map((l, i) => i).filter((i) => !c.product_id || lines[i].product_id === c.product_id);
    const weight = (i: number) =>
      c.allocation === "value" ? Number(lines[i].units || 0) * Number(lines[i].unit_cost || 0) : Number(lines[i].units || 0);
    const total = idx.reduce((a, i) => a + weight(i), 0);
    if (!total) continue;
    for (const i of idx) perLine[i] += (amount * weight(i)) / total;
  }
  return perLine;
}

export function POForm({ initial, suppliers, products }: {
  initial?: POPayload;
  suppliers: Option[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [po, setPo] = useState<POPayload>(
    initial ?? {
      supplier_id: "", paid_via_id: "", po_number: "", invoice_number: "",
      purchase_date: new Date().toISOString().slice(0, 10), arrival_date: "", status: "ordered",
      notes: "", location: "own_warehouse", lines: [{ ...EMPTY_LINE }], costs: [],
    },
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const set = (k: keyof POPayload, v: string) => setPo((p) => ({ ...p, [k]: v }));
  const setLine = (i: number, patch: Partial<POLine>) =>
    setPo((p) => {
      const lines = p.lines.slice();
      const next = { ...lines[i], ...patch };
      // Cajas × unidades por caja → unidades
      const upc = productById.get(next.product_id)?.units_per_case;
      if (("cases" in patch || "product_id" in patch) && upc && next.cases) next.units = String(Number(next.cases) * upc);
      lines[i] = next;
      return { ...p, lines };
    });
  const setCost = (i: number, patch: Partial<POCost>) =>
    setPo((p) => {
      const costs = p.costs.slice();
      costs[i] = { ...costs[i], ...patch };
      return { ...p, costs };
    });

  const allocated = allocateCosts(po.lines, po.costs);
  const productTotal = po.lines.reduce((a, l) => a + Number(l.units || 0) * Number(l.unit_cost || 0), 0);
  const costsTotal = po.costs.reduce((a, c) => a + signed(c), 0);
  const lineProducts = po.lines.filter((l) => l.product_id).map((l) => productById.get(l.product_id)).filter(Boolean) as ProductOption[];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = { ...po, costs: po.costs.map((c) => ({ ...c, amount: String(signed(c)) })) };
    start(async () => {
      const res = await savePurchaseOrder(payload);
      if (res?.error) setError(res.error);
      else if (po.id) router.push(`/compras?ok=${encodeURIComponent("Orden actualizada")}`);
      // Orden nueva: ir a la orden para adjuntar PO, invoice y comprobante de pago.
      else router.push(`/compras/${res?.id}?ok=${encodeURIComponent("Orden creada. Ahora adjunta los documentos.")}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Proveedor *" className="lg:col-span-2">
          <select required value={po.supplier_id} onChange={(e) => set("supplier_id", e.target.value)} className="input">
            <option value="">Selecciona…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Pagada vía (opcional)" className="lg:col-span-2">
          <select value={po.paid_via_id} onChange={(e) => set("paid_via_id", e.target.value)} className="input">
            <option value="">Pago directo desde nuestra cuenta</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Factura"><input value={po.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} className="input" /></Field>
        <Field label="Número PO"><input value={po.po_number} onChange={(e) => set("po_number", e.target.value)} className="input" /></Field>
        <Field label="Fecha de compra *"><input type="date" required value={po.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} className="input" /></Field>
        <Field label="Fecha de llegada"><input type="date" value={po.arrival_date} onChange={(e) => set("arrival_date", e.target.value)} className="input" /></Field>
        <Field label="Estado">
          <select value={po.status} onChange={(e) => set("status", e.target.value)} className="input">
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="¿Dónde llega la mercancía?">
          <select value={po.location} onChange={(e) => set("location", e.target.value)} className="input">
            {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </section>

      {/* 1. Compra neta al proveedor */}
      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <div>
            <h2 className="font-semibold">1. Productos (compra neta al proveedor)</h2>
            <p className="muted text-xs">Lo que factura el proveedor por la mercancía.</p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => setPo((p) => ({ ...p, lines: [...p.lines, { ...EMPTY_LINE }] }))}>
            <Plus size={14} /> Agregar producto
          </button>
        </div>
        <table className="data mt-2 min-w-[860px]">
          <thead>
            <tr>
              <th>Producto</th><th className="num">Cajas</th><th className="num">Unidades</th><th className="num">Costo proveedor/u</th>
              <th className="num">Subtotal</th><th className="num">+ Costos adic./u</th><th className="num">= Costo neto/u</th><th />
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => {
              const u = Number(l.units || 0);
              const extra = u ? allocated[i] / u : 0;
              return (
                <tr key={i}>
                  <td className="min-w-[240px]">
                    <select required value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })} className="input">
                      <option value="">Selecciona…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.description}</option>)}
                    </select>
                  </td>
                  <td className="num w-20"><input type="number" step="any" min="0" value={l.cases} onChange={(e) => setLine(i, { cases: e.target.value })} className="input text-right" /></td>
                  <td className="num w-24"><input type="number" min="1" required value={l.units} onChange={(e) => setLine(i, { units: e.target.value })} className="input text-right" /></td>
                  <td className="num w-28"><input type="number" step="0.0001" min="0" required value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} className="input text-right" /></td>
                  <td className="num">{money(u * Number(l.unit_cost || 0))}</td>
                  <td className="num muted">{money(extra)}</td>
                  <td className="num font-semibold">{money(Number(l.unit_cost || 0) + extra)}</td>
                  <td>
                    <button type="button" aria-label="Quitar producto" className="neg" onClick={() => setPo((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}><X size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted text-xs px-4 py-2">Si el producto tiene “unidades por caja”, al escribir las cajas se calculan las unidades.</p>
      </section>

      {/* 2. Costos adicionales */}
      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <div>
            <h2 className="font-semibold">2. Costos adicionales</h2>
            <p className="muted text-xs">Transporte, envío a Amazon, placement, prep, aranceles, descuentos… Se suman al costo del producto.</p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => setPo((p) => ({ ...p, costs: [...p.costs, emptyCost()] }))}>
            <Plus size={14} /> Agregar costo
          </button>
        </div>
        {po.costs.length === 0 ? (
          <p className="muted text-sm px-4 py-4">Sin costos adicionales. Pulsa “Agregar costo”.</p>
        ) : (
          <table className="data mt-2 min-w-[860px]">
            <thead><tr><th>Tipo</th><th>Descripción</th><th>Aplica a</th><th>Repartir por</th><th className="num">Monto</th><th /></tr></thead>
            <tbody>
              {po.costs.map((c, i) => (
                <tr key={i}>
                  <td className="w-48">
                    <select value={c.cost_type} onChange={(e) => setCost(i, { cost_type: e.target.value })} className="input">
                      {Object.entries(COST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input value={c.description} onChange={(e) => setCost(i, { description: e.target.value })} placeholder="Ej. Factura UPS, envío FBA15…" className="input" /></td>
                  <td className="w-56">
                    <select value={c.product_id} onChange={(e) => setCost(i, { product_id: e.target.value })} className="input">
                      <option value="">Toda la orden</option>
                      {lineProducts.map((p) => <option key={p.id} value={p.id}>{p.description}</option>)}
                    </select>
                  </td>
                  <td className="w-36">
                    <select value={c.allocation} onChange={(e) => setCost(i, { allocation: e.target.value as POCost["allocation"] })} className="input" disabled={!!c.product_id && po.lines.filter((l) => l.product_id === c.product_id).length < 2}>
                      <option value="units">Unidades</option>
                      <option value="value">Valor</option>
                    </select>
                  </td>
                  <td className="num w-32">
                    <input type="number" step="0.01" min="0" required value={c.amount}
                      onChange={(e) => setCost(i, { amount: e.target.value })} className="input text-right" />
                  </td>
                  <td><button type="button" aria-label="Quitar costo" className="neg" onClick={() => setPo((p) => ({ ...p, costs: p.costs.filter((_, j) => j !== i) }))}><X size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted text-xs px-4 py-2">
          “Toda la orden” reparte el costo entre todos los productos; si aplica a uno solo, elígelo. Por unidades = igual por unidad; por valor = proporcional al costo de cada producto.
        </p>
      </section>

      <section className="card p-5">
        <Field label="Notas"><textarea rows={2} value={po.notes} onChange={(e) => set("notes", e.target.value)} className="input" /></Field>
      </section>

      <div className="card p-4 flex flex-wrap items-center gap-x-8 gap-y-2 sticky bottom-4">
        <div><div className="muted text-xs">Compra neta proveedor</div><div className="font-semibold tabular-nums">{money(productTotal)}</div></div>
        <div className="muted">+</div>
        <div><div className="muted text-xs">Costos adicionales</div><div className="font-semibold tabular-nums">{money(costsTotal)}</div></div>
        <div className="muted">=</div>
        <div><div className="muted text-xs">Costo total</div><div className="font-semibold tabular-nums">{money(productTotal + costsTotal)}</div></div>
        <button className="btn-primary ml-auto" disabled={pending}>{pending ? "Guardando…" : "Guardar orden"}</button>
        {error && <p className="neg text-sm w-full">{error}</p>}
      </div>
    </form>
  );
}
