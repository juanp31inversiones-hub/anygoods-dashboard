"use client";

import { useState, useTransition } from "react";
import { setCounterpartyKind } from "@/lib/actions";
import { KIND_LABELS } from "@/lib/format";

/** Selector de tipo que se guarda al cambiar. */
export function KindSelect({ id, kind }: { id: string; kind: string }) {
  const [value, setValue] = useState(kind);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div>
      <select value={value} disabled={pending} className="input py-1 text-xs w-36"
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          setError("");
          start(async () => {
            const res = await setCounterpartyKind(id, next);
            if (res?.error) { setError(res.error); setValue(kind); }
          });
        }}>
        {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {error && <div className="neg text-xs">{error}</div>}
    </div>
  );
}
