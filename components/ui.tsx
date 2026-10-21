import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type HeaderAction = { href: string; label: string; icon?: LucideIcon; variant?: "primary" | "ghost" };

export function PageHeader({ title, subtitle, actions, action }: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: HeaderAction[];
  /** Atajo para una sola acción principal */
  action?: HeaderAction;
}) {
  const all = actions ?? (action ? [action] : []);
  return (
    <div className="flex flex-wrap items-end gap-3 justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="muted text-sm mt-0.5">{subtitle}</p>}
      </div>
      {all.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {all.map(({ href, label, icon: Icon, variant }, i) => (
            <Link key={href} href={href} className={(variant ?? (i === 0 ? "primary" : "ghost")) === "primary" ? "btn-primary" : "btn-ghost"}>
              {Icon && <Icon size={16} />} {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted text-xs mt-1 block">{hint}</span>}
    </label>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="muted text-sm hover:underline">← {label}</Link>;
}

export function Badge({ children, tone }: { children: React.ReactNode; tone?: "neg" | "pos" | "warn" | "muted" }) {
  const styles: Record<string, React.CSSProperties> = {
    neg: { background: "var(--neg-soft)", color: "var(--neg)" },
    pos: { background: "var(--pos-soft)", color: "var(--pos)" },
    warn: { background: "var(--warn-soft)", color: "var(--warn)" },
    muted: { background: "var(--bg)", color: "var(--muted)" },
  };
  return <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap" style={styles[tone ?? "muted"]}>{children}</span>;
}

export function RowLink({ href, label, icon: Icon, tone }: { href: string; label: string; icon?: LucideIcon; tone?: "primary" }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap hover:shadow-sm"
      style={tone === "primary" ? { borderColor: "var(--accent)", color: "var(--accent)" } : { borderColor: "var(--border)" }}>
      {Icon && <Icon size={13} />} {label}
    </Link>
  );
}
