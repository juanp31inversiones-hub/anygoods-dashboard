import Link from "next/link";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end gap-3 justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="muted text-sm mt-0.5">{subtitle}</p>}
      </div>
      {action && <Link href={action.href} className="btn-primary">{action.label}</Link>}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="muted text-sm hover:underline">← {label}</Link>;
}
