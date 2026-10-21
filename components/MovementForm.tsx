"use client";

import { useActionState, useState } from "react";
import { saveMovement, type ActionState } from "@/lib/actions";
import { LOCATION_LABELS, MOVEMENT_LABELS } from "@/lib/format";
import { Field } from "@/components/ui";
import { FormError, SubmitButton } from "@/components/forms";

const HELP: Record<string, string> = {
  transfer: "Mueve unidades entre ubicaciones (ej. del almacén del proveedor a Amazon FBA).",
  adjustment: "Usa un número negativo para restar y positivo para sumar (ej. conteo físico).",
  sale: "Venta fuera de Amazon o registro manual. Las ventas de Amazon se importarán desde Seller Central.",
  damaged: "Unidades dañadas o perdidas. Si Amazon las reembolsa, usa 'Reembolsado por Amazon'.",
  liquidation: "Unidades vendidas en liquidación. Indica el precio por unidad.",
};

export function MovementForm({ products, defaultProduct }: { products: { id: string; description: string }[]; defaultProduct?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveMovement, undefined);
  const [movement, setMovement] = useState("transfer");
  const isTransfer = movement === "transfer";
  const MOVES = Object.entries(MOVEMENT_LABELS).filter(([k]) => k !== "purchase");

  return (
    <form action={action} className="card p-5 grid sm:grid-cols-2 gap-4">
      <Field label="Producto *" className="sm:col-span-2">
        <select name="product_id" required defaultValue={defaultProduct ?? ""} className="input">
          <option value="">Selecciona…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.description}</option>)}
        </select>
      </Field>
      <Field label="Tipo de movimiento *">
        <select name="movement" value={movement} onChange={(e) => setMovement(e.target.value)} className="input">
          {MOVES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Fecha *"><input type="date" name="occurred_on" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></Field>
      <Field label={isTransfer ? "Desde" : "Ubicación"}>
        <select name="location" defaultValue={isTransfer ? "supplier_warehouse" : "amazon_fba"} key={String(isTransfer)} className="input">
          {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      {isTransfer ? (
        <Field label="Hacia">
          <select name="to_location" defaultValue="amazon_fba" className="input">
            {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Precio por unidad (opcional)"><input name="unit_price" type="number" step="0.01" className="input" /></Field>
      )}
      <Field label="Cantidad *"><input name="qty" type="number" required className="input" /></Field>
      <Field label="Referencia (envío FBA, orden, etc.)"><input name="reference" className="input" /></Field>
      <Field label="Notas" className="sm:col-span-2"><textarea name="notes" rows={2} className="input" /></Field>
      {HELP[movement] && <p className="muted text-xs sm:col-span-2">{HELP[movement]}</p>}
      <div className="sm:col-span-2 flex items-center gap-3">
        <SubmitButton label="Registrar" />
        <FormError state={state} />
      </div>
    </form>
  );
}
