"use client";

import { useMemo, useState, useTransition } from "react";
import { PackageMinus, Search } from "lucide-react";
import { applyStockCount } from "@/lib/actions";
import { LOCATION_LABELS, money, units } from "@/lib/format";

export type StockRow = {
  product_id: string;
  description: string;
  asin: string | null;
  image_url: string | null;
  location: string;
  qty: number;
  avg_cost: number;
};

const REASONS = [
  { value: "sale", label: "Vendido", hint: "Se vendió (en Amazon u otro canal) y no quedó registrado" },
  { value: "liquidation", label: "Liquidado", hint: "Vendido a liquidador o con descuento" },
  { value: "damaged", label: "Dañado o perdido", hint: "Pérdida de inventario" },
  { value: "removal", label: "Retirado o devuelto", hint: "Removal de Amazon o devuelto al proveedor" },
  { value: "adjustment", label: "Ajuste de conteo", hint: "Corrección sin causa específica" },
];

export function StockCount({ rows, focus, receivers = [] }: { rows: StockRow[]; focus?: string; receivers?: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [`${r.product_id}|${r.location}`, focus && r.product_id === focus ? "0" : String(r.qty)])),
  );
  const [reason, setReason] = useState("sale");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [deactivate, setDeactivate] = useState(true);
  // Precio de venta/liquidación por fila y quién recibió el dinero
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [collectedBy, setCollectedBy] = useState("");
  const priced = reason === "sale" || reason === "liquidation";

  const key = (r: StockRow) => `${r.product_id}|${r.location}`;
  const diffOf = (r: StockRow) => {
    const v = counts[key(r)];
    return v === "" || v === undefined ? 0 : Number(v) - r.qty;
  };

  const visible = rows.filter((r) => !q || `${r.description} ${r.asin ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const changes = rows.filter((r) => diffOf(r) !== 0);
  const outUnits = changes.reduce((a, r) => a + Math.max(0, -diffOf(r)), 0);
  const outValue = changes.reduce((a, r) => a + Math.max(0, -diffOf(r)) * r.avg_cost, 0);
  const inUnits = changes.reduce((a, r) => a + Math.max(0, diffOf(r)), 0);

  const setAll = (value: (r: StockRow) => string) =>
    setCounts((c) => ({ ...c, ...Object.fromEntries(visible.map((r) => [key(r), value(r)])) }));

  const totals = useMemo(() => rows.reduce((a, r) => a + r.qty, 0), [rows]);

  function submit() {
    setError("");
    start(async () => {
      const res = await applyStockCount({
        date, reason, notes, deactivate,
        collected_by: priced ? collectedBy : "",
        entries: changes.map((r) => ({
          product_id: r.product_id, location: r.location, diff: diffOf(r),
          unit_price: priced && prices[key(r)] !== undefined && prices[key(r)] !== "" ? Number(prices[key(r)]) : null,
        })),
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="card p-4 text-sm space-y-1">
        <p><strong>Cómo usarlo:</strong> en la columna <em>Cantidad real</em> escribe lo que realmente tienes en cada ubicación. Si ya no tienes el producto, pulsa <em>Ya no lo tengo</em> (pone 0).</p>
        <p className="muted">La diferencia se registra como salida con el motivo que elijas abajo. El sistema muestra {units(totals)} unidades en total.</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar productos" className="input pl-9" />
        </div>
        <button type="button" className="btn-ghost" onClick={() => setAll((r) => String(r.qty))}>Restablecer</button>
        <button type="button" className="btn-ghost" onClick={() => setAll(() => "0")}>Poner todo en 0</button>
      </div>

      <section className="card overflow-x-auto">
        <table className="data min-w-[720px]">
          <thead>
            <tr><th>Producto</th><th>Ubicación</th><th className="num">En sistema</th><th className="num">Cantidad real</th><th className="num">Diferencia</th>{priced && <th className="num">Precio de venta/u</th>}<th /></tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = diffOf(r);
              return (
                <tr key={key(r)} style={d !== 0 ? { background: "var(--warn-soft)" } : undefined}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: "var(--bg)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.image_url && <img src={r.image_url} alt="" className="w-full h-full object-contain" />}
                      </div>
                      <div>
                        <div className="leading-snug">{r.description}</div>
                        <div className="muted text-xs">{r.asin ?? ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{LOCATION_LABELS[r.location] ?? r.location}</td>
                  <td className="num">{units(r.qty)}</td>
                  <td className="num w-28">
                    <input type="number" min="0" value={counts[key(r)]} onChange={(e) => setCounts((c) => ({ ...c, [key(r)]: e.target.value }))} className="input text-right" />
                  </td>
                  <td className={`num ${d < 0 ? "neg" : d > 0 ? "pos" : "muted"}`}>{d > 0 ? "+" : ""}{units(d)}</td>
                  {priced && (
                    <td className="num w-28">
                      {d < 0 && (
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={prices[key(r)] ?? ""}
                          onChange={(e) => setPrices((p) => ({ ...p, [key(r)]: e.target.value }))} className="input text-right" />
                      )}
                    </td>
                  )}
                  <td className="text-right">
                    <button type="button" onClick={() => setCounts((c) => ({ ...c, [key(r)]: "0" }))} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap" style={{ borderColor: "var(--border)" }}>
                      <PackageMinus size={13} /> Ya no lo tengo
                    </button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={6} className="muted">No hay productos con stock.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <div className="label">Motivo de la salida</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {REASONS.map((r) => (
              <label key={r.value} className="rounded-lg border p-3 cursor-pointer text-sm"
                style={reason === r.value ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : { borderColor: "var(--border)" }}>
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="sr-only" />
                <div className="font-medium">{r.label}</div>
                <div className="muted text-xs mt-0.5">{r.hint}</div>
              </label>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="block"><span className="label">Fecha</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" /></label>
          <label className="block sm:col-span-2"><span className="label">Notas (opcional)</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Cierre de inventario con base en Seller Central" className="input" /></label>
        </div>
        {priced && (
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">¿Quién recibió el dinero?</span>
              <select value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} className="input">
                <option value="">Nosotros (entra al banco o a Amazon)</option>
                {receivers.map((r) => <option key={r.id} value={r.id}>{r.name} (lo cobró por nosotros)</option>)}
              </select>
            </label>
            <p className="muted text-xs self-end">Si lo cobró un tercero, el total se suma a su cuenta como dinero nuestro que tiene en su poder.</p>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />
          Marcar como inactivos los productos que queden en 0 (siguen en el historial)
        </label>
      </section>

      <div className="card p-4 flex flex-wrap items-center gap-x-8 gap-y-3 sticky bottom-4">
        <div><div className="muted text-xs">Productos con cambios</div><div className="font-semibold">{changes.length}</div></div>
        <div><div className="muted text-xs">Unidades que salen</div><div className="font-semibold neg">{units(outUnits)}</div></div>
        <div><div className="muted text-xs">Valor a costo que sale</div><div className="font-semibold">{money(outValue)}</div></div>
        {priced && (
          <div>
            <div className="muted text-xs">Valor de venta</div>
            <div className="font-semibold">{money(changes.reduce((a, r) => a + Math.max(0, -diffOf(r)) * Number(prices[key(r)] || 0), 0))}</div>
          </div>
        )}
        {inUnits > 0 && <div><div className="muted text-xs">Unidades que se suman</div><div className="font-semibold pos">{units(inUnits)}</div></div>}
        <button type="button" onClick={submit} disabled={pending || changes.length === 0} className="btn-primary ml-auto">
          {pending ? "Aplicando…" : `Aplicar ${changes.length} cambio${changes.length === 1 ? "" : "s"}`}
        </button>
        {error && <p className="neg text-sm w-full">{error}</p>}
      </div>
    </div>
  );
}
