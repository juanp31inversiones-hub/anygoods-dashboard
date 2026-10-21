"use client";

import { useActionState } from "react";
import { saveTransaction, type ActionState } from "@/lib/actions";
import { CATEGORY_LABELS } from "@/lib/format";
import { Field } from "@/components/ui";
import { FormError, SubmitButton } from "@/components/forms";

type Option = { id: string; name: string };
export type Txn = {
  id: string;
  bank_account_id: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string | null;
  counterparty_id: string | null;
  partner_id: string | null;
  purchase_order_id: string | null;
  notes: string | null;
};

export function TxnForm({ txn, accounts, counterparties, partners, purchaseOrders }: {
  txn?: Txn;
  accounts: Option[];
  counterparties: Option[];
  partners: { id: string; short_name: string }[];
  purchaseOrders: Option[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveTransaction, undefined);
  const out = txn ? Number(txn.amount) < 0 : true;
  return (
    <form action={action} className="card p-5 grid sm:grid-cols-2 gap-4">
      <input type="hidden" name="id" value={txn?.id ?? ""} />
      <Field label="Fecha *"><input type="date" name="txn_date" required defaultValue={txn?.txn_date ?? new Date().toISOString().slice(0, 10)} className="input" /></Field>
      <Field label="Cuenta *">
        <select name="bank_account_id" required defaultValue={txn?.bank_account_id ?? accounts[0]?.id} className="input">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Descripción *" className="sm:col-span-2"><input name="description" required defaultValue={txn?.description} className="input" /></Field>
      <Field label="Tipo">
        <select name="direction" defaultValue={out ? "out" : "in"} className="input">
          <option value="out">Egreso (sale dinero)</option>
          <option value="in">Ingreso (entra dinero)</option>
        </select>
      </Field>
      <Field label="Monto (USD) *"><input name="amount" type="number" step="0.01" min="0.01" required defaultValue={txn ? Math.abs(Number(txn.amount)) : ""} className="input" /></Field>
      <Field label="Categoría">
        <select name="category" defaultValue={txn?.category ?? ""} className="input">
          <option value="">Sin categoría</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Contraparte">
        <select name="counterparty_id" defaultValue={txn?.counterparty_id ?? ""} className="input">
          <option value="">—</option>
          {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Socio (para aportes o devoluciones)">
        <select name="partner_id" defaultValue={txn?.partner_id ?? ""} className="input">
          <option value="">—</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.short_name}</option>)}
        </select>
      </Field>
      <Field label="Orden de compra relacionada">
        <select name="purchase_order_id" defaultValue={txn?.purchase_order_id ?? ""} className="input">
          <option value="">—</option>
          {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Notas" className="sm:col-span-2"><textarea name="notes" rows={2} defaultValue={txn?.notes ?? ""} className="input" /></Field>
      <div className="sm:col-span-2 flex items-center gap-3">
        <SubmitButton />
        <FormError state={state} />
      </div>
    </form>
  );
}
