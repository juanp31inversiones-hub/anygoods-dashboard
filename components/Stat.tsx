export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="card p-4">
      <div className="muted text-xs uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${tone ?? ""}`}>{value}</div>
      {hint && <div className="muted text-xs mt-1">{hint}</div>}
    </div>
  );
}
