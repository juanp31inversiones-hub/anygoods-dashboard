import Link from "next/link";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { Badge, PageHeader } from "@/components/ui";
import { RegisterAmazonShipment, SyncInboundButton } from "@/components/AmazonInbound";
import { LOCATION_LABELS, date, money, units } from "@/lib/format";
import type { InboundItem } from "@/lib/amazon/inbound";

type Row = {
  id: string;
  shipment_id: string | null;
  name: string | null;
  destination_fc: string | null;
  from_location: string;
  status: string;
  created_on: string;
  shipped_on: string | null;
  fba_shipment_items: { qty_shipped: number; qty_received: number | null; products: { description: string } | null }[];
  fba_shipment_costs: { amount: number }[];
};
type Amz = { shipment_id: string; name: string | null; destination_fc: string | null; status: string; shipped_on: string | null; items: InboundItem[]; ignored: boolean };

/** Pasos que ve el usuario; varios estados internos caen en el mismo paso. */
const STEPS = [
  { label: "Creado", statuses: ["working"] },
  { label: "En camino", statuses: ["shipped", "in_transit", "delivered"] },
  { label: "Amazon contando", statuses: ["receiving"] },
  { label: "Terminado", statuses: ["closed"] },
];
const AMAZON_STATUS: Record<string, string> = {
  WORKING: "Borrador", READY_TO_SHIP: "Listo para enviar", SHIPPED: "Enviado", IN_TRANSIT: "En tránsito", DELIVERED: "Entregado",
  CHECKED_IN: "Llegó a Amazon", RECEIVING: "Amazon contando", CLOSED: "Terminado", CANCELLED: "Cancelado", DELETED: "Eliminado", ERROR: "Error",
};

export default async function Envios() {
  const supabase = await createClient();
  const [{ data }, { data: amzData }, { data: listings }, stock] = await Promise.all([
    supabase.from("fba_shipments")
      .select("id, shipment_id, name, destination_fc, from_location, status, created_on, shipped_on, fba_shipment_items(qty_shipped, qty_received, products(description)), fba_shipment_costs(amount)")
      .order("created_on", { ascending: false }).returns<Row[]>(),
    supabase.from("amazon_inbound_shipments").select("*").order("shipped_on", { ascending: false, nullsFirst: true }).returns<Amz[]>(),
    supabase.from("amazon_listings").select("sku, product_id, products(description, active)"),
    stockByLocation(supabase, false),
  ]);
  const rows = data ?? [];
  const linked = new Set(rows.map((r) => r.shipment_id).filter(Boolean));
  const productOf = new Map(((listings ?? []) as unknown as { sku: string; product_id: string | null; products: { description: string; active: boolean } | null }[])
    .map((l) => [l.sku, l]));
  const stockOf = new Map(stock.map((s) => [s.product_id, s.stock]));

  // Envíos de Amazon sin registrar: los recientes o con productos activos se muestran; los antiguos quedan aparte
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const unregistered = (amzData ?? []).filter((a) => !linked.has(a.shipment_id) && !a.ignored && !["CANCELLED", "DELETED", "ERROR"].includes(a.status));
  const isRecent = (a: Amz) => !["CLOSED"].includes(a.status) || !a.shipped_on || a.shipped_on >= cutoff
    || a.items.some((i) => productOf.get(i.sku)?.products?.active);
  const pendingAmz = unregistered.filter(isRecent);
  const oldAmz = unregistered.filter((a) => !isRecent(a));
  const manualWithoutId = rows.filter((r) => !r.shipment_id && r.status !== "cancelled")
    .map((r) => ({ id: r.id, label: `${r.name ?? "Envío"} (${date(r.shipped_on ?? r.created_on)}, ${r.fba_shipment_items.reduce((a, i) => a + i.qty_shipped, 0)} und)` }));
  const bestOrigin = (a: Amz) => {
    const totals: Record<string, number> = {};
    for (const it of a.items) {
      const st = stockOf.get(productOf.get(it.sku)?.product_id ?? "") ?? {};
      for (const loc of ["supplier_warehouse", "own_warehouse", "prep_center"]) totals[loc] = (totals[loc] ?? 0) + Math.max(0, st[loc] ?? 0);
    }
    return Object.entries(totals).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "own_warehouse";
  };

  const shipped = (r: Row) => r.fba_shipment_items.reduce((a, i) => a + i.qty_shipped, 0);
  const received = (r: Row) => r.fba_shipment_items.reduce((a, i) => a + (i.qty_received ?? (r.status === "closed" ? i.qty_shipped : 0)), 0);
  const cost = (r: Row) => r.fba_shipment_costs.reduce((a, c) => a + Number(c.amount), 0);
  const missing = (r: Row) => (r.status === "closed" ? Math.max(0, shipped(r) - received(r)) : 0);
  const open = rows.filter((r) => !["closed", "cancelled"].includes(r.status));
  const done = rows.filter((r) => r.status === "closed");
  const products = (r: Row) => r.fba_shipment_items.map((i) => `${units(i.qty_shipped)} × ${i.products?.description ?? "?"}`).join(" · ");

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader title="Envíos a Amazon" subtitle="Mercancía que sale de tu bodega o del proveedor hacia los centros de Amazon."
        actions={[{ href: "/envios/nuevo", label: "Registrar a mano", icon: Plus, variant: "ghost" }]} />

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Cómo funciona</h2>
        <ol className="grid sm:grid-cols-3 gap-3 text-sm">
          <li><b>1. Crea el envío en Seller Central</b><span className="muted block">Como siempre: Send to Amazon, etiquetas y transportadora.</span></li>
          <li><b>2. Pulsa “Traer envíos de Amazon”</b><span className="muted block">Aparece abajo. Solo dices de dónde salieron las unidades y lo registras.</span></li>
          <li><b>3. La app hace el seguimiento</b><span className="muted block">Estado y unidades recibidas se actualizan solos. Si Amazon recibe menos, te avisa para reclamar.</span></li>
        </ol>
        <SyncInboundButton />
      </section>

      {pendingAmz.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">Nuevos en Amazon: falta registrarlos ({pendingAmz.length})</h2>
          {pendingAmz.map((a) => {
            const unlinkedSkus = a.items.filter((i) => !productOf.get(i.sku)?.product_id);
            return (
              <div key={a.shipment_id} className="card p-4 space-y-3" style={{ borderColor: "var(--warn)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-semibold">{a.shipment_id}</span>
                    <span className="muted text-sm"> · {a.name ?? ""}{a.destination_fc ? ` · centro ${a.destination_fc}` : ""}</span>
                  </div>
                  <Badge tone="warn">{AMAZON_STATUS[a.status] ?? a.status}</Badge>
                </div>
                <ul className="text-sm space-y-0.5">
                  {a.items.map((i) => (
                    <li key={i.sku}>
                      {units(i.shipped)} × {productOf.get(i.sku)?.products?.description ?? <span className="neg">SKU {i.sku} sin vincular</span>}
                      {i.received > 0 && <span className="muted"> · Amazon recibió {units(i.received)}</span>}
                    </li>
                  ))}
                </ul>
                {unlinkedSkus.length ? (
                  <p className="text-sm neg">Vincula primero los SKUs en <Link href="/amazon?tab=skus" className="link">Amazon → SKUs</Link>.</p>
                ) : (
                  <RegisterAmazonShipment amazonId={a.shipment_id} defaultOrigin={bestOrigin(a)} existing={manualWithoutId} />
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">En curso ({open.length})</h2>
        {open.length === 0 && <p className="muted text-sm">No hay envíos en camino.</p>}
        {open.map((r) => {
          const step = STEPS.findIndex((s) => s.statuses.includes(r.status));
          return (
            <Link key={r.id} href={`/envios/${r.id}`} className="card p-4 block space-y-3 hover:shadow-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{r.shipment_id ?? r.name ?? "Envío"}</span>
                <span className="muted text-sm">{date(r.shipped_on ?? r.created_on)} · desde {LOCATION_LABELS[r.from_location]}{r.destination_fc ? ` → ${r.destination_fc}` : ""}</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {STEPS.map((s, i) => (
                  <div key={s.label}>
                    <div className="h-1.5 rounded-full" style={{ background: i <= step ? "var(--accent)" : "var(--border)" }} />
                    <div className={`text-xs mt-1 ${i === step ? "font-semibold" : "muted"}`}>{s.label}</div>
                  </div>
                ))}
              </div>
              <p className="text-sm muted">{products(r)}</p>
            </Link>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Terminados ({done.length})</h2>
        <div className="card overflow-x-auto">
          <table className="data">
            <thead><tr><th>Envío</th><th>Fecha</th><th>Productos</th><th className="num">Enviadas</th><th className="num">Recibidas</th><th className="num">Costo/u</th></tr></thead>
            <tbody>
              {done.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/envios/${r.id}`} className="link font-medium">{r.shipment_id ?? r.name ?? "Envío"}</Link>
                    {!r.shipment_id && <div className="muted text-xs">Sin vincular a Amazon</div>}
                  </td>
                  <td className="whitespace-nowrap">{date(r.shipped_on ?? r.created_on)}</td>
                  <td className="text-sm max-w-[280px]">{products(r)}</td>
                  <td className="num">{units(shipped(r))}</td>
                  <td className="num">
                    {units(received(r))}
                    {missing(r) > 0
                      ? <div className="neg text-xs flex items-center justify-end gap-1"><AlertTriangle size={12} /> faltan {missing(r)}: reclamar</div>
                      : <div className="pos text-xs flex items-center justify-end gap-1"><CheckCircle2 size={12} /> completo</div>}
                  </td>
                  <td className="num">{shipped(r) ? money(cost(r) / shipped(r)) : "—"}</td>
                </tr>
              ))}
              {done.length === 0 && <tr><td colSpan={6} className="muted">Aún no hay envíos terminados.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {oldAmz.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer font-medium">Envíos antiguos en Amazon que no están en la app ({oldAmz.length}) · solo consulta</summary>
          <p className="muted text-xs mt-2">Son envíos de productos que ya no manejas. No hace falta registrarlos: su inventario ya está cerrado.</p>
          <table className="data mt-2">
            <thead><tr><th>Envío</th><th>Fecha</th><th>Productos</th><th className="num">Enviadas</th><th className="num">Recibidas</th></tr></thead>
            <tbody>
              {oldAmz.map((a) => (
                <tr key={a.shipment_id}>
                  <td>{a.shipment_id}<div className="muted text-xs">{a.destination_fc}</div></td>
                  <td className="whitespace-nowrap">{date(a.shipped_on)}</td>
                  <td className="text-sm">{a.items.map((i) => productOf.get(i.sku)?.products?.description ?? i.sku).join(" · ")}</td>
                  <td className="num">{units(a.items.reduce((s, i) => s + i.shipped, 0))}</td>
                  <td className="num">{units(a.items.reduce((s, i) => s + i.received, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
