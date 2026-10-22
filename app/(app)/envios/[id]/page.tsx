import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { FbaShipmentEditor } from "@/components/FbaShipmentEditor";
import { DeleteButton } from "@/components/forms";
import { BackLink } from "@/components/ui";
import { deleteFbaShipment } from "@/lib/actions";
import { loadShipmentPayload } from "@/lib/shipmentPayload";
import { SHIPMENT_STATUS_LABELS } from "@/lib/format";

export default async function EditarEnvio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [products, initial] = await Promise.all([stockByLocation(supabase, false, id), loadShipmentPayload(supabase, id)]);
  if (!initial) notFound();
  const sh = initial;

  return (
    <div className="space-y-4">
      <BackLink href="/envios" label="Envíos FBA" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{sh.shipment_id || sh.name || "Envío"}</h1>
          <p className="muted text-sm">{SHIPMENT_STATUS_LABELS[sh.status]}{sh.destination_fc ? ` · ${sh.destination_fc}` : ""}</p>
        </div>
        <DeleteButton action={deleteFbaShipment.bind(null, id)} confirmText="¿Eliminar este envío? Sus unidades vuelven a la ubicación de origen." />
      </div>
      <FbaShipmentEditor initial={initial} products={products} />
    </div>
  );
}
