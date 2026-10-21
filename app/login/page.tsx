"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [password, setPassword] = useState("");
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
    if (error) {
      setError(
        /rate limit/i.test(error.message)
          ? "Se alcanzó el límite de correos por hora. Entra con contraseña o espera unos minutos."
          : error.message,
      );
    } else setStep("code");
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) {
      setError("Correo o contraseña incorrectos. Si aún no tienes contraseña, entra con código y créala en Mi cuenta.");
      return;
    }
    router.replace("/");
    router.refresh();
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
        <div className="flex justify-center mb-4"><Logo className="h-14" /></div>
        <p className="muted text-sm text-center">Panel de control · Acceso solo para usuarios autorizados.</p>

        {step === "password" ? (
          <form onSubmit={signInWithPassword} className="mt-6 space-y-3">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com"
              className={input} style={{ borderColor: "var(--border)" }} />
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña"
              autoComplete="current-password" className={input} style={{ borderColor: "var(--border)" }} />
            <button disabled={busy} className={button} style={{ background: "var(--accent)" }}>{busy ? "Entrando…" : "Entrar"}</button>
            <button type="button" onClick={() => { setStep("email"); setError(""); }} className="muted text-sm underline w-full">
              No tengo contraseña: entrar con código por correo
            </button>
          </form>
        ) : step === "email" ? (
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
            <button type="button" onClick={() => { setStep("password"); setError(""); }} className="muted text-sm underline w-full">
              Entrar con contraseña
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
