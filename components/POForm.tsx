"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePurchaseOrder, type POLine, type POPayload } from "@/lib/actions";
import { LOCATION_LABELS, STATUS_LABELS, money } from "@/lib/format";
import { Field } from "@/components/ui";

type Option = { id: string; name: string };
type ProductOption = { id: string; description: string; units_per_case: number | null };

const EMPTY_LINE: POLine = { product_id: "", cases: "", units: "", unit_cost: "" };

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
      supplier_shipping: "", amazon_shipping: "", amazon_placement_fee: "", prep_cost: "", notes: "",
      location: "amazon_fba", lines: [{ ...EMPTY_LINE }],
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

  const product = po.lines.reduce((a, l) => a + Number(l.units || 0) * Number(l.unit_cost || 0), 0);
  const logistics = ["supplier_shipping", "amazon_shipping", "amazon_placement_fee", "prep_cost"]
    .reduce((a, k) => a + Number(po[k as keyof POPayload] || 0), 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await savePurchaseOrder(po);
      if (res?.error) setError(res.error);
      else router.push(`/compras?ok=${encodeURIComponent(po.id ? "Orden actualizada" : "Orden creada")}`);
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
        <Field label="Ubicación de productos nuevos">
          <select value={po.location} onChange={(e) => set("location", e.target.value)} className="input">
            {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </section>

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold">Productos</h2>
          <button type="button" className="btn-ghost text-xs" onClick={() => setPo((p) => ({ ...p, lines: [...p.lines, { ...EMPTY_LINE }] }))}>
            + Agregar producto
          </button>
        </div>
        <table className="data mt-2 min-w-[720px]">
          <thead><tr><th>Producto</th><th className="num">Cajas</th><th className="num">Unidades</th><th className="num">Costo und</th><th className="num">Subtotal</th><th /></tr></thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i}>
                <td className="min-w-[260px]">
                  <select required value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })} className="input">
                    <option value="">Selecciona…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.description}</option>)}
                  </select>
                </td>
                <td className="num w-24"><input type="number" step="any" min="0" value={l.cases} onChange={(e) => setLine(i, { cases: e.target.value })} className="input text-right" /></td>
                <td className="num w-28"><input type="number" min="1" required value={l.units} onChange={(e) => setLine(i, { units: e.target.value })} className="input text-right" /></td>
                <td className="num w-28"><input type="number" step="0.0001" min="0" required value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} className="input text-right" /></td>
                <td className="num">{money(Number(l.units || 0) * Number(l.unit_cost || 0))}</td>
                <td>
                  <button type="button" aria-label="Quitar" className="neg text-sm" onClick={() => setPo((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted text-xs px-4 py-2">Si el producto tiene “unidades por caja”, al escribir las cajas se calculan las unidades.</p>
      </section>

      <section className="card p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Transporte proveedor"><input type="number" step="0.01" min="0" value={po.supplier_shipping} onChange={(e) => set("supplier_shipping", e.target.value)} className="input" /></Field>
        <Field label="Envío a Amazon"><input type="number" step="0.01" min="0" value={po.amazon_shipping} onChange={(e) => set("amazon_shipping", e.target.value)} className="input" /></Field>
        <Field label="Inbound placement fee"><input type="number" step="0.01" min="0" value={po.amazon_placement_fee} onChange={(e) => set("amazon_placement_fee", e.target.value)} className="input" /></Field>
        <Field label="Prep / etiquetado"><input type="number" step="0.01" min="0" value={po.prep_cost} onChange={(e) => set("prep_cost", e.target.value)} className="input" /></Field>
        <Field label="Notas" className="sm:col-span-2 lg:col-span-4"><textarea rows={2} value={po.notes} onChange={(e) => set("notes", e.target.value)} className="input" /></Field>
      </section>

      <div className="card p-4 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div><div className="muted text-xs">Producto</div><div className="font-semibold tabular-nums">{money(product)}</div></div>
        <div><div className="muted text-xs">Logística y fees</div><div className="font-semibold tabular-nums">{money(logistics)}</div></div>
        <div><div className="muted text-xs">Total</div><div className="font-semibold tabular-nums">{money(product + logistics)}</div></div>
        <p className="muted text-xs flex-1 min-w-[200px]">La logística se reparte entre los productos según su valor para calcular el costo final por unidad.</p>
        <button className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar orden"}</button>
      </div>
      {error && <p className="neg text-sm">{error}</p>}
    </form>
  );
}
