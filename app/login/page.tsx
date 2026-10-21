"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold">AnyGoods Dashboard</h1>
        <p className="muted text-sm mt-1">Acceso solo para socios.</p>
        {state === "sent" ? (
          <p className="mt-6 text-sm">
            Te enviamos un enlace de acceso a <strong>{email}</strong>. Revisa tu correo.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
            <button
              disabled={state === "sending"}
              className="w-full rounded-lg px-3 py-2 font-medium text-white disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              {state === "sending" ? "Enviando…" : "Enviar enlace de acceso"}
            </button>
            {state === "error" && <p className="neg text-sm">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
