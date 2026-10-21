"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { deletePayment, savePayment, type ActionState } from "@/lib/actions";
import { PAYMENT_METHOD_LABELS, date, money } from "@/lib/format";
import { DeleteButton, FormError, SubmitButton } from "@/components/forms";
import { Badge, Field } from "@/components/ui";

export type Payment = {
  id: string;
  paid_on: string;
  amount: number;
  method: string;
  notes: string | null;
  paid_by: { name: string } | null;
  bank: { txn_date: string; description: string } | null;
};
type Option = { id: string; name: string };

export function POPayments({ poId, total, payments, agents, transactions }: {
  poId: string;
  total: number;
  payments: Payment[];
  agents: Option[];
  transactions: Option[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(savePayment, undefined);
  const [method, setMethod] = useState("bank");
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const paid = payments.reduce((a, p) => a + Number(p.amount), 0);
  const balance = Math.round((total - paid) * 100) / 100;

  useEffect(() => {
    if (state?.id) { form.current?.reset(); setOpen(false); setMethod("bank"); }
  }, [state]);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Wallet size={18} /> Pagos al proveedor</h2>
          <p className="muted text-xs mt-0.5">Registra cada pago: desde el banco, con tarjeta o hecho por un tercero (ej. EC Access).</p>
        </div>
        <div className="flex gap-6 text-sm">
          <div><div className="muted text-xs">Total compra</div><div className="font-semibold tabular-nums">{money(total)}</div></div>
          <div><div className="muted text-xs">Pagado</div><div className="font-semibold tabular-nums">{money(paid)}</div></div>
          <div>
            <div className="muted text-xs">Saldo</div>
            <div className={`font-semibold tabular-nums ${balance > 0 ? "neg" : ""}`}>{money(balance)}</div>
          </div>
          <div className="self-center">
            {balance <= 0.009 && balance >= -0.009 ? <Badge tone="pos">Pagada</Badge> : balance > 0 ? <Badge tone="warn">Saldo pendiente</Badge> : <Badge tone="neg">Pagado de más</Badge>}
          </div>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Fecha</th><th>Cómo</th><th>Detalle</th><th className="num">Monto</th><th /></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{date(p.paid_on)}</td>
                  <td>{p.method === "third_party" ? `Pagado por ${p.paid_by?.name ?? "tercero"}` : PAYMENT_METHOD_LABELS[p.method]}</td>
                  <td className="muted">{p.bank ? `${p.bank.description} (${date(p.bank.txn_date)})` : ""}{p.notes ? `${p.bank ? " · " : ""}${p.notes}` : ""}</td>
                  <td className="num">{money(p.amount)}</td>
                  <td><DeleteButton action={deletePayment.bind(null, p.id)} label="✕" confirmText="¿Eliminar este pago?" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!open ? (
        <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(true)}>+ Registrar pago</button>
      ) : (
        <form ref={form} action={action} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg p-4" style={{ background: "var(--bg)" }}>
          <input type="hidden" name="purchase_order_id" value={poId} />
          <Field label="Fecha"><input type="date" name="paid_on" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></Field>
          <Field label="Monto (USD)"><input type="number" name="amount" step="0.01" min="0.01" required defaultValue={balance > 0 ? balance : ""} className="input" /></Field>
          <Field label="¿Cómo se pagó?">
            <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {method === "third_party" ? (
            <Field label="¿Quién pagó por nosotros?">
              <select name="paid_by_id" required className="input">
                <option value="">Selecciona…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          ) : method === "bank" || method === "card" ? (
            <Field label="Movimiento del banco (opcional)">
              <select name="bank_transaction_id" className="input">
                <option value="">—</option>
                {transactions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          ) : <div />}
          <Field label="Notas" className="sm:col-span-2 lg:col-span-3"><input name="notes" className="input" placeholder="Ej. Abono 50%, saldo de liquidación…" /></Field>
          <div className="flex items-end gap-2">
            <SubmitButton label="Guardar pago" />
            <button type="button" className="muted text-sm underline" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
          <div className="sm:col-span-2 lg:col-span-4"><FormError state={state} /></div>
        </form>
      )}
    </section>
  );
}
