"use client";

import { useActionState, useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
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

/** Categorías que tienen sentido según si entra o sale plata (las más usadas primero). */
const CATS = {
  out: ["inventory", "shipping", "fees", "software", "legal", "service_fee", "other_expense", "capital_return", "transfer"],
  in: ["amazon_payout", "other_sales", "capital_contribution", "transfer"],
};

export function TxnForm({ txn, accounts, counterparties, partners, purchaseOrders }: {
  txn?: Txn;
  accounts: Option[];
  counterparties: Option[];
  partners: { id: string; short_name: string }[];
  purchaseOrders: Option[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveTransaction, undefined);
  const [direction, setDirection] = useState<"out" | "in">(txn && Number(txn.amount) > 0 ? "in" : "out");
  const [category, setCategory] = useState(txn?.category ?? "");
  const hasDetails = !!(txn?.counterparty_id || txn?.partner_id || txn?.purchase_order_id || txn?.notes);

  return (
    <form action={action} className="card p-4 sm:p-5 space-y-5">
      <input type="hidden" name="id" value={txn?.id ?? ""} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="category" value={category} />

      {/* 1. ¿Entra o sale? */}
      <div className="grid grid-cols-2 gap-2">
        {([["out", "Salida", "Pago o gasto", ArrowUpRight, "var(--neg)", "var(--neg-soft)"], ["in", "Entrada", "Ingreso o aporte", ArrowDownLeft, "var(--pos)", "var(--pos-soft)"]] as const)
          .map(([key, label, hint, Icon, color, soft]) => (
            <button key={key} type="button" onClick={() => { setDirection(key); if (!CATS[key].includes(category)) setCategory(""); }}
              className="rounded-xl border-2 p-3 text-left"
              style={direction === key ? { borderColor: color, background: soft } : { borderColor: "var(--border)" }}>
              <span className="flex items-center gap-1.5 font-semibold" style={{ color: direction === key ? color : undefined }}><Icon size={18} /> {label}</span>
              <span className="muted text-xs">{hint}</span>
            </button>
          ))}
      </div>

      {/* 2. Monto */}
      <label className="block">
        <span className="label">Monto</span>
        <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--border)" }}>
          <span className="text-2xl muted">$</span>
          <input name="amount" type="number" inputMode="decimal" step="0.01" min="0.01" required placeholder="0.00"
            defaultValue={txn ? Math.abs(Number(txn.amount)) : ""} className="w-full bg-transparent text-3xl font-semibold py-2 outline-none tabular-nums" />
        </div>
      </label>

      {/* 3. Qué fue */}
      <Field label="¿Qué fue?"><input name="description" required defaultValue={txn?.description} placeholder={direction === "out" ? "Ej: Pago a Cleaning Heroes" : "Ej: Pago de Amazon"} className="input" /></Field>

      <div>
        <span className="label">Categoría</span>
        <div className="flex flex-wrap gap-2">
          {CATS[direction].map((k) => (
            <button key={k} type="button" onClick={() => setCategory(category === k ? "" : k)} className="rounded-full border px-3 py-1.5 text-sm"
              style={category === k ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "var(--border)" }}>
              {CATEGORY_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha"><input type="date" name="txn_date" required defaultValue={txn?.txn_date ?? new Date().toISOString().slice(0, 10)} className="input" /></Field>
        {accounts.length > 1 ? (
          <Field label="Cuenta">
            <select name="bank_account_id" required defaultValue={txn?.bank_account_id ?? accounts[0]?.id} className="input">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        ) : (
          <div><span className="label">Cuenta</span><div className="py-2 text-sm">{accounts[0]?.name}</div><input type="hidden" name="bank_account_id" value={txn?.bank_account_id ?? accounts[0]?.id} /></div>
        )}
      </div>

      {/* Detalles opcionales */}
      <details open={hasDetails} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
        <summary className="text-sm cursor-pointer muted">Más detalles (opcional): proveedor, socio, orden de compra, notas</summary>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Field label="Proveedor / cliente">
            <select name="counterparty_id" defaultValue={txn?.counterparty_id ?? ""} className="input">
              <option value="">—</option>
              {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Socio (aportes o devoluciones)">
            <select name="partner_id" defaultValue={txn?.partner_id ?? ""} className="input">
              <option value="">—</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.short_name}</option>)}
            </select>
          </Field>
          <Field label="Orden de compra">
            <select name="purchase_order_id" defaultValue={txn?.purchase_order_id ?? ""} className="input">
              <option value="">—</option>
              {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Notas" className="sm:col-span-2"><textarea name="notes" rows={2} defaultValue={txn?.notes ?? ""} className="input" /></Field>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <SubmitButton label={txn ? "Guardar cambios" : direction === "out" ? "Registrar salida" : "Registrar entrada"} />
        <FormError state={state} />
      </div>
    </form>
  );
}
