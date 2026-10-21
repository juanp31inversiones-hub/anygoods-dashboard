"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "link") {
      setError("El enlace no funcionó en este navegador. Pide un código y escríbelo aquí.");
    }
  }, []);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) {
      setError("Código inválido o vencido. Pide uno nuevo.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const input = "w-full rounded-lg border px-3 py-2 bg-transparent";
  const button = "w-full rounded-lg px-3 py-2 font-medium text-white disabled:opacity-60";

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold">AnyGoods Dashboard</h1>
        <p className="muted text-sm mt-1">Acceso solo para usuarios autorizados.</p>

        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className={input}
              style={{ borderColor: "var(--border)" }}
            />
            <button disabled={busy} className={button} style={{ background: "var(--accent)" }}>
              {busy ? "Enviando…" : "Enviar código de acceso"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="mt-6 space-y-3">
            <p className="text-sm">
              Enviamos un código a <strong>{email}</strong>. Escríbelo aquí (también puedes abrir el enlace del
              correo en este mismo navegador).
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Código"
              className={`${input} tracking-widest text-center text-lg`}
              style={{ borderColor: "var(--border)" }}
            />
            <button disabled={busy || code.length < 6} className={button} style={{ background: "var(--accent)" }}>
              {busy ? "Verificando…" : "Entrar"}
            </button>
            <button type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }} className="muted text-sm underline w-full">
              Usar otro correo o reenviar código
            </button>
          </form>
        )}
        {error && <p className="neg text-sm mt-3">{error}</p>}
      </div>
    </main>
  );
}
