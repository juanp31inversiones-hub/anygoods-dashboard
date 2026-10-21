import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader } from "@/components/ui";
import { LOCATION_LABELS, SHIPMENT_STATUS_LABELS, date, money, units } from "@/lib/format";

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
  fba_shipment_costs: { amount: number; charged_to: string }[];
};

const TONE: Record<string, "muted" | "warn" | "pos" | "neg"> = {
  working: "muted", shipped: "warn", in_transit: "warn", delivered: "warn", receiving: "warn", closed: "pos", cancelled: "neg",
};

export default async function Envios() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fba_shipments")
    .select("id, shipment_id, name, destination_fc, from_location, status, created_on, shipped_on, fba_shipment_items(qty_shipped, qty_received, products(description)), fba_shipment_costs(amount, charged_to)")
    .order("created_on", { ascending: false })
    .returns<Row[]>();
  const rows = data ?? [];

  const shipped = (r: Row) => r.fba_shipment_items.reduce((a, i) => a + i.qty_shipped, 0);
  const cost = (r: Row) => r.fba_shipment_costs.reduce((a, c) => a + Number(c.amount), 0);
  const shortage = (r: Row) =>
    r.status === "closed" ? r.fba_shipment_items.reduce((a, i) => a + Math.max(0, i.qty_shipped - (i.qty_received ?? i.qty_shipped)), 0) : 0;

  const open = rows.filter((r) => ["shipped", "in_transit", "delivered", "receiving"].includes(r.status));
  const inTransit = open.reduce((a, r) => a + shipped(r), 0);
  const active = rows.filter((r) => r.status !== "cancelled");
  const totalCost = active.reduce((a, r) => a + cost(r), 0);
  const totalUnits = active.reduce((a, r) => a + shipped(r), 0);
  const missing = rows.reduce((a, r) => a + shortage(r), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Envíos FBA" subtitle="Envíos de tu inventario a los centros de Amazon" action={{ href: "/envios/nuevo", label: "Nuevo envío", icon: Plus }} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Envíos abiertos</div><div className="text-2xl font-semibold mt-1">{open.length}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Unidades en camino</div><div className="text-2xl font-semibold mt-1">{units(inTransit)}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Costo promedio de envío</div><div className="text-2xl font-semibold mt-1">{money(totalUnits ? totalCost / totalUnits : 0)}</div><div className="muted text-xs">por unidad</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Faltantes por reclamar</div><div className={`text-2xl font-semibold mt-1 ${missing ? "neg" : ""}`}>{units(missing)}</div><div className="muted text-xs">unidades no recibidas</div></div>
      </section>

      <section className="card overflow-x-auto">
        <table className="data min-w-[900px]">
          <thead>
            <tr><th>Envío</th><th>Estado</th><th>Destino</th><th>Fecha</th><th className="num">Enviadas</th><th className="num">Recibidas</th><th className="num">Costo</th><th className="num">Costo/u</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const S = shipped(r);
              const received = ["receiving", "closed"].includes(r.status) ? r.fba_shipment_items.reduce((a, i) => a + (i.qty_received ?? (r.status === "closed" ? i.qty_shipped : 0)), 0) : null;
              const miss = shortage(r);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/envios/${r.id}`} className="link font-medium">{r.shipment_id ?? r.name ?? "Envío sin ID"}</Link>
                    <div className="muted text-xs">{r.name && r.shipment_id ? `${r.name} · ` : ""}{r.fba_shipment_items.length} producto{r.fba_shipment_items.length === 1 ? "" : "s"} · desde {LOCATION_LABELS[r.from_location]}</div>
                  </td>
                  <td>
                    <Badge tone={TONE[r.status]}>{SHIPMENT_STATUS_LABELS[r.status]}</Badge>
                    {miss > 0 && <div className="neg text-xs mt-1 flex items-center gap-1"><AlertTriangle size={12} /> Faltan {miss}</div>}
                  </td>
                  <td>{r.destination_fc ?? "—"}</td>
                  <td className="whitespace-nowrap">{date(r.shipped_on ?? r.created_on)}</td>
                  <td className="num">{units(S)}</td>
                  <td className="num">{received === null ? "—" : units(received)}</td>
                  <td className="num">{money(cost(r))}</td>
                  <td className="num">{money(S ? cost(r) / S : 0)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="muted">Aún no hay envíos. Cuando crees un envío en Seller Central (Send to Amazon), regístralo aquí con su Shipment ID.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
