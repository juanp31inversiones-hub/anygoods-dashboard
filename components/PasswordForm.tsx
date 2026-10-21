"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui";

export function PasswordForm() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setMsg({ ok: false, text: "Usa al menos 10 caracteres." });
    if (pw !== pw2) return setMsg({ ok: false, text: "Las contraseñas no coinciden." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Contraseña guardada. Ya puedes entrar con correo y contraseña." });
    if (!error) { setPw(""); setPw2(""); }
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold">Contraseña</h2>
        <p className="muted text-xs mt-1">Crea o cambia tu contraseña para entrar sin esperar códigos por correo.</p>
      </div>
      <Field label="Nueva contraseña"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="input" /></Field>
      <Field label="Repite la contraseña"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="input" /></Field>
      <button className="btn-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
      {msg && <p className={`text-sm ${msg.ok ? "pos" : "neg"}`}>{msg.text}</p>}
    </form>
  );
}
