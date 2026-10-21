"use client";

import { useActionState } from "react";
import { saveCounterparty, type ActionState } from "@/lib/actions";
import { KIND_LABELS } from "@/lib/format";
import { Field } from "@/components/ui";
import { FormError, SubmitButton } from "@/components/forms";

export type Counterparty = {
  id: string;
  name: string;
  kind: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
};

export function CounterpartyForm({ cp }: { cp?: Counterparty }) {
  const [state, action] = useActionState<ActionState, FormData>(saveCounterparty, undefined);
  return (
    <form action={action} className="card p-5 grid sm:grid-cols-2 gap-4">
      <input type="hidden" name="id" value={cp?.id ?? ""} />
      <Field label="Nombre *"><input name="name" required defaultValue={cp?.name} className="input" /></Field>
      <Field label="Tipo">
        <select name="kind" defaultValue={cp?.kind ?? "supplier"} className="input">
          {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Contacto"><input name="contact_name" defaultValue={cp?.contact_name ?? ""} className="input" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={cp?.email ?? ""} className="input" /></Field>
      <Field label="Teléfono"><input name="phone" defaultValue={cp?.phone ?? ""} className="input" /></Field>
      <Field label="Sitio web"><input name="website" defaultValue={cp?.website ?? ""} className="input" /></Field>
      <Field label="Notas" className="sm:col-span-2"><textarea name="notes" rows={3} defaultValue={cp?.notes ?? ""} className="input" /></Field>
      <div className="sm:col-span-2 flex items-center gap-3">
        <SubmitButton />
        <FormError state={state} />
      </div>
    </form>
  );
}
