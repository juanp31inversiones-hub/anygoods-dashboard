import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { FbaShipmentEditor } from "@/components/FbaShipmentEditor";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deleteFbaShipment, type FbaShipmentPayload } from "@/lib/actions";
import { SHIPMENT_STATUS_LABELS } from "@/lib/format";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditarEnvio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [products, { data: sh }] = await Promise.all([
    stockByLocation(supabase, false, id),
    supabase.from("fba_shipments").select("*, fba_shipment_items(id, product_id, qty_shipped, qty_received), fba_shipment_costs(id, cost_type, description, amount, charged_to, allocation)").eq("id", id).single(),
  ]);
  if (!sh) notFound();

  const initial: FbaShipmentPayload = {
    id: sh.id,
    shipment_id: s(sh.shipment_id), name: s(sh.name), destination_fc: s(sh.destination_fc), from_location: sh.from_location,
    status: sh.status, created_on: s(sh.created_on), shipped_on: s(sh.shipped_on), closed_on: s(sh.closed_on),
    carrier: s(sh.carrier), tracking: s(sh.tracking), boxes: s(sh.boxes), weight_lb: s(sh.weight_lb), notes: s(sh.notes),
    items: (sh.fba_shipment_items as { id: string; product_id: string; qty_shipped: number; qty_received: number | null }[]).map((i) => ({
      id: i.id, product_id: i.product_id, qty_shipped: s(i.qty_shipped), qty_received: s(i.qty_received),
    })),
    costs: (sh.fba_shipment_costs as { id: string; cost_type: string; description: string | null; amount: number; charged_to: string; allocation: "units" | "value" }[]).map((c) => ({
      id: c.id, cost_type: c.cost_type, description: s(c.description), amount: s(c.amount), charged_to: c.charged_to, allocation: c.allocation,
    })),
  };

  return (
    <div className="space-y-4">
      <BackLink href="/envios" label="Envíos FBA" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{sh.shipment_id ?? sh.name ?? "Envío"}</h1>
          <p className="muted text-sm">{SHIPMENT_STATUS_LABELS[sh.status]}{sh.destination_fc ? ` · ${sh.destination_fc}` : ""}</p>
        </div>
        <DeleteButton action={deleteFbaShipment.bind(null, id)} confirmText="¿Eliminar este envío? Sus unidades vuelven a la ubicación de origen." />
      </div>
      <FbaShipmentEditor initial={initial} products={products} />
    </div>
  );
}
