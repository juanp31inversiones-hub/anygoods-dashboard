"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

export function SubmitButton({ label = "Guardar", pending = "Guardando…" }: { label?: string; pending?: string }) {
  const { pending: isPending } = useFormStatus();
  return <button className="btn-primary" disabled={isPending}>{isPending ? pending : label}</button>;
}

export function FormError({ state }: { state: ActionState }) {
  return state?.error ? <p className="neg text-sm">{state.error}</p> : null;
}

/** Botón de borrado con confirmación. `action` es una server action ligada al id. */
export function DeleteButton({ action, label = "Eliminar", confirmText }: {
  action: () => Promise<ActionState>;
  label?: string;
  confirmText: string;
}) {
  const [state, formAction, pending] = useActionState(async () => action(), undefined);
  return (
    <form action={formAction} onSubmit={(e) => { if (!confirm(confirmText)) e.preventDefault(); }} className="inline-flex flex-col items-start gap-1">
      <button className="btn-danger" disabled={pending}>{pending ? "Eliminando…" : label}</button>
      <FormError state={state} />
    </form>
  );
}
