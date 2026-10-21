"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

/** Muestra el mensaje de confirmación que las acciones envían como ?ok=... */
export function Flash() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const msg = params.get("ok");
  const [visible, setVisible] = useState(!!msg);

  useEffect(() => {
    setVisible(!!msg);
    if (!msg) return;
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  if (!msg || !visible) return null;
  const close = () => {
    setVisible(false);
    const next = new URLSearchParams(params);
    next.delete("ok");
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  };
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg text-white" style={{ background: "var(--pos-strong)" }}>
      <CheckCircle2 size={18} />
      <span className="flex-1">{msg}</span>
      <button onClick={close} aria-label="Cerrar"><X size={16} /></button>
    </div>
  );
}
