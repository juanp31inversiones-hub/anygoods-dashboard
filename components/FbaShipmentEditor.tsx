"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, X } from "lucide-react";
import { saveFbaShipment, type FbaShipmentPayload, type ShipmentCost, type ShipmentItem } from "@/lib/actions";
import {
  CHARGED_TO_LABELS, FBA_COST_TYPE_LABELS, LOCATION_LABELS, SHIPMENT_MOVING, SHIPMENT_STATUS, money, units,
} from "@/lib/format";
import { Field } from "@/components/ui";

export type ShipProduct = {
  product_id: string;
  description: string;
  asin: string | null;
  image_url: string | null;
  avg_cost: number | null;
  stock: Record<string, number>;
};

const ORIGINS = ["own_warehouse", "supplier_warehouse", "prep_center"];
const today = () => new Date().toISOString().slice(0, 10);
const emptyItem = (product_id = ""): ShipmentItem => ({ product_id, qty_shipped: "", qty_received: "" });
const emptyCost = (): ShipmentCost => ({ cost_type: "inbound_shipping", description: "", amount: "", charged_to: "amazon_balance", allocation: "units" });

/** Reparte los costos del envío entre sus productos (igual que v_shipment_item_costs). */
function allocate(items: ShipmentItem[], costs: ShipmentCost[], unitCost: (id: string) => number) {
  const per = items.map(() => 0);
  for (const c of costs) {
    const amount = Number(c.amount || 0);
    const w = items.map((it) => (c.allocation === "value" ? Number(it.qty_shipped || 0) * unitCost(it.product_id) : Number(it.qty_shipped || 0)));
    const total = w.reduce((a, b) => a + b, 0);
    if (!amount || !total) continue;
    w.forEach((x, i) => (per[i] += (amount * x) / total));
  }
  return per;
}

export function FbaShipmentEditor({ initial, products, defaultProduct }: {
  initial?: FbaShipmentPayload;
  products: ShipProduct[];
  defaultProduct?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [s, setS] = useState<FbaShipmentPayload>(
    initial ?? {
      shipment_id: "", name: "", destination_fc: "", from_location: "own_warehouse", status: "working",
      created_on: today(), shipped_on: "", closed_on: "", carrier: "amazon_partnered", tracking: "", boxes: "", weight_lb: "", notes: "",
      items: [emptyItem(defaultProduct ?? "")], costs: [],
    },
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const set = (k: keyof FbaShipmentPayload, v: string) => setS((x) => ({ ...x, [k]: v }));
  const setItem = (i: number, patch: Partial<ShipmentItem>) => setS((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const setCost = (i: number, patch: Partial<ShipmentCost>) => setS((x) => ({ ...x, costs: x.costs.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  // Cambiar de estado completa fechas útiles
  function setStatus(status: string) {
    setS((x) => ({
      ...x,
      status,
      shipped_on: SHIPMENT_MOVING.includes(status) && !x.shipped_on ? today() : x.shipped_on,
      closed_on: status === "closed" && !x.closed_on ? today() : x.closed_on,
    }));
  }

  const moving = SHIPMENT_MOVING.includes(s.status);
  const receiving = s.status === "receiving" || s.status === "closed";
  const unitCost = (id: string) => Number(byId.get(id)?.avg_cost ?? 0);
  const perItem = allocate(s.items, s.costs, unitCost);
  const totalShipped = s.items.reduce((a, it) => a + Number(it.qty_shipped || 0), 0);
  const totalReceived = s.items.reduce((a, it) => a + (it.qty_received === "" ? 0 : Number(it.qty_received)), 0);
  const totalCosts = s.costs.reduce((a, c) => a + Number(c.amount || 0), 0);
  const fromAmazon = s.costs.filter((c) => c.charged_to === "amazon_balance").reduce((a, c) => a + Number(c.amount || 0), 0);
  const shortages = receiving ? s.items.filter((it) => it.qty_received !== "" && Number(it.qty_received) < Number(it.qty_shipped || 0)) : [];
  const overStock = moving && s.items.some((it) => it.product_id && Number(it.qty_shipped || 0) > (byId.get(it.product_id)?.stock[s.from_location] ?? 0));
  const usedIds = new Set(s.items.map((it) => it.product_id));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await saveFbaShipment(s);
      if (res?.error) return setError(res.error);
      router.push(`/envios/${res?.id}?ok=${encodeURIComponent(s.id ? "Envío actualizado" : "Envío creado")}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Estado */}
      <section className="card p-4">
        <div className="label">Estado del envío</div>
        <div className="flex flex-wrap gap-2">
          {SHIPMENT_STATUS.map((st) => (
            <button type="button" key={st.key} onClick={() => setStatus(st.key)} title={st.hint}
              className="rounded-full border px-3 py-1.5 text-sm"
              style={s.status === st.key ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "var(--border)" }}>
              {st.label}
            </button>
          ))}
        </div>
        <p className="muted text-xs mt-2">{SHIPMENT_STATUS.find((x) => x.key === s.status)?.hint}.{" "}
          {s.status === "working" ? "En borrador no se mueve inventario." : moving ? "Las unidades ya salieron de tu inventario." : ""}</p>
      </section>

      {/* Datos */}
      <section className="card p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Shipment ID (Seller Central)"><input value={s.shipment_id} onChange={(e) => set("shipment_id", e.target.value)} placeholder="FBA15XXXXXXX" className="input uppercase" /></Field>
        <Field label="Centro de Amazon destino"><input value={s.destination_fc} onChange={(e) => set("destination_fc", e.target.value)} placeholder="ORF2, MCC1, SWF2…" className="input uppercase" /></Field>
        <Field label="Nombre o referencia"><input value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Matcha oct-2026" className="input" /></Field>
        <Field label="Sale de">
          <select value={s.from_location} onChange={(e) => set("from_location", e.target.value)} className="input">
            {ORIGINS.map((k) => <option key={k} value={k}>{LOCATION_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Fecha de creación"><input type="date" value={s.created_on} onChange={(e) => set("created_on", e.target.value)} className="input" /></Field>
        <Field label="Fecha de envío"><input type="date" value={s.shipped_on} onChange={(e) => set("shipped_on", e.target.value)} className="input" /></Field>
        <Field label="Fecha de cierre"><input type="date" value={s.closed_on} onChange={(e) => set("closed_on", e.target.value)} className="input" /></Field>
        <Field label="Transportadora">
          <select value={s.carrier} onChange={(e) => set("carrier", e.target.value)} className="input">
            <option value="amazon_partnered">Amazon Partnered Carrier</option>
            <option value="own">Mi transportadora (UPS, FedEx, LTL…)</option>
          </select>
        </Field>
        <Field label="Tracking"><input value={s.tracking} onChange={(e) => set("tracking", e.target.value)} className="input" /></Field>
        <Field label="Cajas"><input type="number" min="0" value={s.boxes} onChange={(e) => set("boxes", e.target.value)} className="input" /></Field>
        <Field label="Peso total (lb)"><input type="number" min="0" step="0.01" value={s.weight_lb} onChange={(e) => set("weight_lb", e.target.value)} className="input" /></Field>
        <Field label="Notas"><input value={s.notes} onChange={(e) => set("notes", e.target.value)} className="input" /></Field>
      </section>

      {/* Productos */}
      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <div>
            <h2 className="font-semibold">Productos del envío</h2>
            <p className="muted text-xs">Unidades que salen de {LOCATION_LABELS[s.from_location]}. Lo que no envíes se queda ahí.</p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => setS((x) => ({ ...x, items: [...x.items, emptyItem()] }))}><Plus size={14} /> Agregar producto</button>
        </div>
        <table className="data mt-2 min-w-[900px]">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Disponible</th>
              <th className="num">Enviadas</th>
              <th className="num">Recibidas por Amazon</th>
              <th className="num">Diferencia</th>
              <th className="num">Envío/u</th>
              <th className="num">Costo neto en Amazon/u</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.items.map((it, i) => {
              const p = byId.get(it.product_id);
              const avail = p?.stock[s.from_location] ?? 0;
              const S = Number(it.qty_shipped || 0);
              const diff = it.qty_received === "" ? null : Number(it.qty_received) - S;
              const inbound = S ? perItem[i] / S : 0;
              return (
                <tr key={i}>
                  <td className="min-w-[240px]">
                    <select value={it.product_id} onChange={(e) => setItem(i, { product_id: e.target.value })} className="input">
                      <option value="">Selecciona…</option>
                      {products.filter((x) => x.product_id === it.product_id || !usedIds.has(x.product_id)).map((x) => (
                        <option key={x.product_id} value={x.product_id}>
                          {x.description} ({units(x.stock[s.from_location] ?? 0)} disp.)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{it.product_id ? units(avail) : "—"}</td>
                  <td className="num w-28">
                    <input type="number" min="1" value={it.qty_shipped} onChange={(e) => setItem(i, { qty_shipped: e.target.value })}
                      className="input text-right" style={moving && S > avail ? { borderColor: "var(--neg)" } : undefined} />
                    {it.product_id && <button type="button" className="text-[11px] link" onClick={() => setItem(i, { qty_shipped: String(avail) })}>Todo</button>}
                  </td>
                  <td className="num w-32">
                    <input type="number" min="0" disabled={!receiving} value={it.qty_received} placeholder={receiving ? String(S || "") : "—"}
                      onChange={(e) => setItem(i, { qty_received: e.target.value })} className="input text-right" />
                  </td>
                  <td className={`num ${diff === null ? "muted" : diff < 0 ? "neg" : diff > 0 ? "pos" : ""}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${units(diff)}`}</td>
                  <td className="num muted">{money(inbound)}</td>
                  <td className="num font-semibold">{p ? money(Number(p.avg_cost ?? 0) + inbound) : "—"}</td>
                  <td><button type="button" aria-label="Quitar" className="neg" onClick={() => setS((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}><X size={16} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted text-xs px-4 py-2">“Recibidas” se habilita en <strong>Recibiendo</strong> y <strong>Cerrado</strong>. Al cerrar, si lo dejas vacío se asume que llegó todo.</p>
      </section>

      {shortages.length > 0 && (
        <div className="card p-4 flex gap-3 text-sm" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
          <AlertTriangle size={18} className="shrink-0" style={{ color: "var(--warn)" }} />
          <div>
            <strong>Faltan {units(shortages.reduce((a, it) => a + Number(it.qty_shipped) - Number(it.qty_received), 0))} unidades.</strong>{" "}
            Revisa en Seller Central el detalle del envío y, si no aparecen después de la recepción, abre un caso de reconciliación para solicitar el reembolso.
            Al cerrar el envío, el faltante queda registrado como pérdida para que no infle tu inventario.
          </div>
        </div>
      )}

      {/* Costos */}
      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <div>
            <h2 className="font-semibold">Costos del envío</h2>
            <p className="muted text-xs">Se reparten entre los productos del envío y se suman a su costo neto en Amazon.</p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => setS((x) => ({ ...x, costs: [...x.costs, emptyCost()] }))}><Plus size={14} /> Agregar costo</button>
        </div>
        {s.costs.length === 0 ? (
          <p className="muted text-sm px-4 py-4">Sin costos. Agrega el transporte a Amazon y el inbound placement fee que muestra Seller Central.</p>
        ) : (
          <table className="data mt-2 min-w-[860px]">
            <thead><tr><th>Tipo</th><th>Descripción</th><th>¿Cómo se pagó?</th><th>Repartir por</th><th className="num">Monto</th><th /></tr></thead>
            <tbody>
              {s.costs.map((c, i) => (
                <tr key={i}>
                  <td className="w-52">
                    <select value={c.cost_type} onChange={(e) => setCost(i, { cost_type: e.target.value })} className="input">
                      {Object.entries(FBA_COST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input value={c.description} onChange={(e) => setCost(i, { description: e.target.value })} className="input" /></td>
                  <td className="w-60">
                    <select value={c.charged_to} onChange={(e) => setCost(i, { charged_to: e.target.value })} className="input">
                      {Object.entries(CHARGED_TO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="w-36">
                    <select value={c.allocation} onChange={(e) => setCost(i, { allocation: e.target.value as ShipmentCost["allocation"] })} className="input">
                      <option value="units">Unidades</option>
                      <option value="value">Valor</option>
                    </select>
                  </td>
                  <td className="num w-32"><input type="number" step="0.01" min="0" value={c.amount} onChange={(e) => setCost(i, { amount: e.target.value })} className="input text-right" /></td>
                  <td><button type="button" aria-label="Quitar" className="neg" onClick={() => setS((x) => ({ ...x, costs: x.costs.filter((_, j) => j !== i) }))}><X size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted text-xs px-4 py-2">
          El transporte con Amazon Partnered Carrier, el placement fee y los servicios de prep de Amazon normalmente se descuentan del saldo de tu cuenta de vendedor, no del banco.
        </p>
      </section>

      <div className="card p-4 flex flex-wrap items-center gap-x-8 gap-y-2 sticky bottom-4">
        <div><div className="muted text-xs">Unidades enviadas</div><div className="font-semibold">{units(totalShipped)}</div></div>
        {receiving && <div><div className="muted text-xs">Recibidas</div><div className="font-semibold">{units(totalReceived)}</div></div>}
        <div><div className="muted text-xs">Costo del envío</div><div className="font-semibold">{money(totalCosts)}</div></div>
        <div><div className="muted text-xs">Por unidad</div><div className="font-semibold">{money(totalShipped ? totalCosts / totalShipped : 0)}</div></div>
        {fromAmazon > 0 && <div><div className="muted text-xs">Descontado por Amazon</div><div className="font-semibold">{money(fromAmazon)}</div></div>}
        <button className="btn-primary ml-auto" disabled={pending || overStock}>{pending ? "Guardando…" : "Guardar envío"}</button>
        {overStock && <p className="neg text-sm w-full">Hay productos con más unidades de las disponibles en {LOCATION_LABELS[s.from_location]}.</p>}
        {error && <p className="neg text-sm w-full">{error}</p>}
      </div>
    </form>
  );
}
