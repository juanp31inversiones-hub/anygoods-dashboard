"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { createShipment } from "@/lib/actions";
import { LOCATION_LABELS, units } from "@/lib/format";
import { Field } from "@/components/ui";

export type StockByLocation = { product_id: string; description: string; asin: string | null; image_url: string | null; stock: Record<string, number> };

export function ShipmentForm({ products, defaultProduct }: { products: StockByLocation[]; defaultProduct?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [from, setFrom] = useState("own_warehouse");
  const [to, setTo] = useState("amazon_fba");
  const [shipmentId, setShipmentId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const rows = products.filter((p) => (p.stock[from] ?? 0) > 0 || p.product_id === defaultProduct);
  const lines = rows.map((p) => ({ product_id: p.product_id, qty: Number(qty[p.product_id] || 0) })).filter((l) => l.qty > 0);
  const total = lines.reduce((a, l) => a + l.qty, 0);
  const over = rows.some((p) => Number(qty[p.product_id] || 0) > (p.stock[from] ?? 0));

  function submit() {
    setError("");
    start(async () => {
      const res = await createShipment({ shipment_id: shipmentId.trim(), date, from_location: from, to_location: to, notes, lines });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <section className="card p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Sale de">
          <select value={from} onChange={(e) => { setFrom(e.target.value); setQty({}); }} className="input">
            {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Llega a">
          <select value={to} onChange={(e) => setTo(e.target.value)} className="input">
            {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="ID del envío (Shipment ID)"><input value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="FBA15XXXXXXX" className="input" /></Field>
        <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" /></Field>
        <Field label="Notas (opcional)" className="sm:col-span-2 lg:col-span-4"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. 3 cajas, transportadora UPS" className="input" /></Field>
      </section>

      <section className="card overflow-x-auto">
        <table className="data min-w-[640px]">
          <thead>
            <tr><th>Producto</th><th className="num">Disponible en {LOCATION_LABELS[from]}</th><th className="num">Ya en {LOCATION_LABELS[to]}</th><th className="num">Unidades a enviar</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const avail = p.stock[from] ?? 0;
              const v = qty[p.product_id] ?? "";
              const bad = Number(v || 0) > avail;
              return (
                <tr key={p.product_id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: "var(--bg)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-contain" />}
                      </div>
                      <div>
                        <div>{p.description}</div>
                        <div className="muted text-xs">{p.asin ?? ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{units(avail)}</td>
                  <td className="num muted">{units(p.stock[to] ?? 0)}</td>
                  <td className="num w-32">
                    <input type="number" min="0" max={avail} value={v} onChange={(e) => setQty((q) => ({ ...q, [p.product_id]: e.target.value }))}
                      className="input text-right" style={bad ? { borderColor: "var(--neg)" } : undefined} />
                  </td>
                  <td><button type="button" className="text-xs link" onClick={() => setQty((q) => ({ ...q, [p.product_id]: String(avail) }))}>Todo</button></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No hay productos con stock en {LOCATION_LABELS[from]}.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="card p-4 flex flex-wrap items-center gap-x-8 gap-y-3 sticky bottom-4">
        <div><div className="muted text-xs">Productos</div><div className="font-semibold">{lines.length}</div></div>
        <div><div className="muted text-xs">Unidades a enviar</div><div className="font-semibold">{units(total)}</div></div>
        <p className="muted text-xs flex-1 min-w-[200px]">El costo del envío regístralo como costo adicional “Envío a Amazon” en la orden de compra correspondiente.</p>
        <button type="button" onClick={submit} disabled={pending || !lines.length || over} className="btn-primary">
          <Send size={16} /> {pending ? "Registrando…" : "Registrar envío"}
        </button>
        {over && <p className="neg text-sm w-full">Hay cantidades mayores a lo disponible.</p>}
        {error && <p className="neg text-sm w-full">{error}</p>}
      </div>
    </div>
  );
}
