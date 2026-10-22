"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, EyeOff, RefreshCw, XCircle } from "lucide-react";
import { ignoreAmazonShipment, registerAmazonShipment, runAmazon } from "@/lib/amazonActions";
import { LOCATION_LABELS } from "@/lib/format";

type Msg = { ok: boolean; text: string } | null;

function Result({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`text-sm flex items-start gap-2 ${msg.ok ? "pos" : "neg"}`}>
      {msg.ok ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <XCircle size={16} className="shrink-0 mt-0.5" />} {msg.text}
    </p>
  );
}

export function SyncInboundButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button className="btn-primary" disabled={pending} onClick={() => start(async () => {
        const r = await runAmazon("inbound");
        setMsg({ ok: r.ok, text: r.message });
        router.refresh();
      })}>
        <RefreshCw size={16} className={pending ? "animate-spin" : ""} /> {pending ? "Trayendo envíos…" : "Traer envíos de Amazon"}
      </button>
      <Result msg={msg} />
    </div>
  );
}

const ORIGINS = ["supplier_warehouse", "own_warehouse", "prep_center"];

/** Envío creado en Amazon que aún no está en la app: elegir de dónde salió y registrarlo (o vincularlo a uno existente). */
export function RegisterAmazonShipment({ amazonId, defaultOrigin, existing }: {
  amazonId: string;
  defaultOrigin: string;
  existing: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState(defaultOrigin);
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) router.refresh();
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {existing.length > 0 && (
          <label className="text-sm">
            <span className="label">¿Ya lo registraste a mano?</span>
            <select className="input w-auto" value={link} onChange={(e) => setLink(e.target.value)}>
              <option value="">No, es un envío nuevo</option>
              {existing.map((e) => <option key={e.id} value={e.id}>Sí: {e.label}</option>)}
            </select>
          </label>
        )}
        {!link && (
          <label className="text-sm">
            <span className="label">¿De dónde salieron las unidades?</span>
            <select className="input w-auto" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {ORIGINS.map((o) => <option key={o} value={o}>{LOCATION_LABELS[o]}</option>)}
            </select>
          </label>
        )}
        <button className="btn-primary" disabled={pending} onClick={() => run(() => registerAmazonShipment(amazonId, origin, link || undefined))}>
          {pending ? "Guardando…" : link ? "Vincular" : "Registrar envío"}
        </button>
        <button className="btn-ghost" disabled={pending} title="No registrar este envío" onClick={() => run(() => ignoreAmazonShipment(amazonId))}>
          <EyeOff size={15} /> Ocultar
        </button>
      </div>
      <Result msg={msg} />
    </div>
  );
}
