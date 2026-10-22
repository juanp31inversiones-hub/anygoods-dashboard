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
  const variantOf = (a: HeaderAction, i: number) => a.variant ?? (i === 0 ? "primary" : "ghost");
  const primary = all.find((a, i) => variantOf(a, i) === "primary");
  const rest = all.filter((a) => a !== primary);
  const PrimaryIcon = primary?.icon;
  return (
    <div className="flex flex-wrap items-end gap-3 justify-between">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="muted text-sm mt-0.5 hidden sm:block">{subtitle}</p>}
      </div>
      {all.length > 0 && (
        <div className="hidden sm:flex flex-wrap gap-2">
          {all.map(({ href, label, icon: Icon }, i) => (
            <Link key={href} href={href} className={variantOf(all[i], i) === "primary" ? "btn-primary" : "btn-ghost"}>
              {Icon && <Icon size={16} />} {label}
            </Link>
          ))}
        </div>
      )}
      {/* Celular: acciones secundarias pequeñas y la principal como botón flotante */}
      {rest.length > 0 && (
        <div className="sm:hidden flex flex-wrap gap-2 w-full">
          {rest.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="btn-ghost py-1.5 px-3 text-xs">{Icon && <Icon size={14} />} {label}</Link>
          ))}
        </div>
      )}
      {primary && (
        <Link href={primary.href} aria-label={primary.label}
          className="sm:hidden fixed right-4 z-30 rounded-full shadow-lg flex items-center gap-2 px-5 h-12 text-white font-medium text-sm"
          style={{ background: "var(--accent)", bottom: "calc(5rem + env(safe-area-inset-bottom))" }}>
          {PrimaryIcon && <PrimaryIcon size={18} />} {primary.label}
        </Link>
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
