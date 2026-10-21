"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, RefreshCw, Scale, XCircle } from "lucide-react";
import { linkSku, reconcileFba, runAmazon } from "@/lib/amazonActions";

type Msg = { ok: boolean; text: string } | null;

function Result({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`text-sm flex items-start gap-2 ${msg.ok ? "pos" : "neg"}`}>
      {msg.ok ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <XCircle size={16} className="shrink-0 mt-0.5" />} {msg.text}
    </p>
  );
}

/** Botones de sincronización. Las ventas se traen por tramos hasta quedar al día. */
export function SyncButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  async function run(kind: "connection" | "inventory" | "finances") {
    setBusy(kind);
    setMsg(null);
    if (kind === "finances") {
      // Repite tramos de ~45 s mientras Amazon tenga historial pendiente
      for (let i = 0; i < 60; i++) {
        const r = await runAmazon("finances");
        setMsg({ ok: r.ok, text: r.message });
        router.refresh();
        if (!r.ok || r.complete) break;
      }
    } else {
      const r = await runAmazon(kind);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={!!busy} onClick={() => run("connection")}>
          <RefreshCw size={16} className={busy === "connection" ? "animate-spin" : ""} /> Probar conexión
        </button>
        <button className="btn-primary" disabled={!!busy} onClick={() => run("inventory")}>
          <RefreshCw size={16} className={busy === "inventory" ? "animate-spin" : ""} /> Sincronizar inventario FBA
        </button>
        <button className="btn-primary" disabled={!!busy} onClick={() => run("finances")}>
          <RefreshCw size={16} className={busy === "finances" ? "animate-spin" : ""} /> Sincronizar ventas y fees
        </button>
      </div>
      {busy === "finances" && <p className="muted text-xs">Trayendo historial desde abr-2025 por tramos; puede tardar varios minutos la primera vez. No cierres esta página.</p>}
      <Result msg={msg} />
    </div>
  );
}

export function ReconcileButton({ productId, label = "Cuadrar con Amazon" }: { productId?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="inline-flex flex-col gap-1">
      <button className={productId ? "btn-ghost text-xs py-1 px-2" : "btn-primary"} disabled={pending}
        onClick={() => {
          if (!confirm("Se registrará como venta la diferencia entre el sistema y lo que Amazon reporta en FBA. ¿Continuar?")) return;
          start(async () => { const r = await reconcileFba(productId); setMsg({ ok: r.ok, text: r.message }); router.refresh(); });
        }}>
        <Scale size={productId ? 13 : 16} /> {pending ? "Cuadrando…" : label}
      </button>
      {!productId && <Result msg={msg} />}
    </div>
  );
}

export function LinkSelect({ sku, productId, products }: { sku: string; productId: string | null; products: { id: string; description: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState(productId ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Link2 size={14} className={value ? "pos" : "muted"} />
      <select value={value} disabled={pending} className="input py-1 text-xs min-w-[240px]"
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          start(async () => { await linkSku(sku, v || null); router.refresh(); });
        }}>
        <option value="">Sin vincular</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.description}</option>)}
      </select>
    </div>
  );
}
