"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { HandCoins } from "lucide-react";
import { deleteAgentEntry, saveAgentEntry, type ActionState } from "@/lib/actions";
import { AGENT_ENTRY_LABELS, date, money } from "@/lib/format";
import { DeleteButton, FormError, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";

export type LedgerRow = { id?: string; date: string; concept: string; detail: string; amount: number; deletable?: boolean };

/** Cuenta con un tercero que maneja dinero nuestro: movimientos y saldo. */
export function AgentAccount({ counterpartyId, name, rows }: { counterpartyId: string; name: string; rows: LedgerRow[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveAgentEntry, undefined);
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.id) { form.current?.reset(); setOpen(false); } }, [state]);

  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const withBalance = sorted.map((r) => ({ ...r, balance: (running += r.amount) }));
  const balance = running;

  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><HandCoins size={18} /> Cuenta con {name}</h2>
          <p className="muted text-xs mt-0.5">Lo que le dimos o cobró a nuestro favor (+) y lo que pagó por nosotros o nos devolvió (−).</p>
        </div>
        <div className="text-right">
          <div className="muted text-xs">Saldo que {name} tiene nuestro</div>
          <div className={`text-2xl font-semibold tabular-nums ${balance > 1 ? "neg" : ""}`}>{money(balance)}</div>
        </div>
      </div>
      <table className="data mt-3 min-w-[720px]">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Detalle</th><th className="num">Monto</th><th className="num">Saldo</th><th /></tr></thead>
        <tbody>
          {withBalance.map((r, i) => (
            <tr key={r.id ?? i}>
              <td className="whitespace-nowrap">{date(r.date)}</td>
              <td>{r.concept}</td>
              <td className="muted">{r.detail}</td>
              <td className={`num ${r.amount < 0 ? "neg" : "pos"}`}>{r.amount > 0 ? "+" : ""}{money(r.amount)}</td>
              <td className="num">{money(r.balance)}</td>
              <td>{r.deletable && r.id && <DeleteButton action={deleteAgentEntry.bind(null, r.id)} label="✕" confirmText="¿Eliminar este movimiento?" />}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">Sin movimientos.</td></tr>}
        </tbody>
      </table>
      <div className="p-4">
        {!open ? (
          <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(true)}>+ Registrar dinero cobrado o cobro de {name}</button>
        ) : (
          <form ref={form} action={action} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg p-4" style={{ background: "var(--bg)" }}>
            <input type="hidden" name="counterparty_id" value={counterpartyId} />
            <Field label="Fecha"><input type="date" name="entry_date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></Field>
            <Field label="Tipo">
              <select name="kind" className="input">
                {Object.entries(AGENT_ENTRY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Monto (USD)"><input type="number" name="amount" step="0.01" required className="input" /></Field>
            <Field label="Descripción"><input name="description" className="input" /></Field>
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
              <SubmitButton />
              <button type="button" className="muted text-sm underline" onClick={() => setOpen(false)}>Cancelar</button>
              <FormError state={state} />
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
