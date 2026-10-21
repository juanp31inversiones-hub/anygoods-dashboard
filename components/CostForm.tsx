"use client";

import { useActionState, useState } from "react";
import { saveCost, type ActionState } from "@/lib/actions";
import { PO_COST_TYPE_LABELS } from "@/lib/format";
import { Field } from "@/components/ui";
import { FormError, SubmitButton } from "@/components/forms";

type Option = { id: string; name: string };
export type PoOption = { id: string; name: string; products: { id: string; description: string }[] };
export type Cost = {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  cost_type: string;
  description: string | null;
  amount: number;
  allocation: string;
  cost_date: string | null;
  counterparty_id: string | null;
  bank_transaction_id: string | null;
};

export function CostForm({ cost, purchaseOrders, counterparties, transactions, defaultPo, defaultProduct }: {
  cost?: Cost;
  purchaseOrders: PoOption[];
  counterparties: Option[];
  transactions: Option[];
  defaultPo?: string;
  defaultProduct?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveCost, undefined);
  const [poId, setPoId] = useState(cost?.purchase_order_id ?? defaultPo ?? "");
  const poProducts = purchaseOrders.find((p) => p.id === poId)?.products ?? [];

  return (
    <form action={action} className="card p-5 grid sm:grid-cols-2 gap-4">
      <input type="hidden" name="id" value={cost?.id ?? ""} />
      <Field label="Orden de compra *" className="sm:col-span-2">
        <select name="purchase_order_id" required value={poId} onChange={(e) => setPoId(e.target.value)} className="input">
          <option value="">Selecciona…</option>
          {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Tipo de costo *">
        <select name="cost_type" required defaultValue={cost?.cost_type ?? "supplier_shipping"} className="input">
          {Object.entries(PO_COST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Monto (USD) *" hint="Para descuentos escribe el monto en positivo: se resta automáticamente.">
        <input name="amount" type="number" step="0.01" min="0" required defaultValue={cost ? Math.abs(Number(cost.amount)) : ""} className="input" />
      </Field>
      <Field label="Aplica a">
        <select name="product_id" defaultValue={cost?.product_id ?? defaultProduct ?? ""} key={poId} className="input">
          <option value="">Toda la orden</option>
          {poProducts.map((p) => <option key={p.id} value={p.id}>{p.description}</option>)}
        </select>
      </Field>
      <Field label="Repartir por" hint="Solo importa si aplica a varios productos.">
        <select name="allocation" defaultValue={cost?.allocation ?? "units"} className="input">
          <option value="units">Unidades (igual por unidad)</option>
          <option value="value">Valor (proporcional al costo)</option>
        </select>
      </Field>
      <Field label="Descripción" className="sm:col-span-2"><input name="description" defaultValue={cost?.description ?? ""} placeholder="Ej. Factura prep center #123, envío FBA15XYZ" className="input" /></Field>
      <Field label="Fecha"><input name="cost_date" type="date" defaultValue={cost?.cost_date ?? new Date().toISOString().slice(0, 10)} className="input" /></Field>
      <Field label="Pagado a">
        <select name="counterparty_id" defaultValue={cost?.counterparty_id ?? ""} className="input">
          <option value="">—</option>
          {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Pago en banco relacionado (opcional)" className="sm:col-span-2">
        <select name="bank_transaction_id" defaultValue={cost?.bank_transaction_id ?? ""} className="input">
          <option value="">—</option>
          {transactions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2 flex items-center gap-3">
        <SubmitButton />
        <FormError state={state} />
      </div>
    </form>
  );
}
