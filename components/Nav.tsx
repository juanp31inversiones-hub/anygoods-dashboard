"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Resumen" },
  { href: "/productos", label: "Productos" },
  { href: "/proveedores", label: "Proveedores" },
  { href: "/compras", label: "Compras" },
  { href: "/inventario", label: "Inventario" },
  { href: "/banco", label: "Banco" },
];

export function Nav({ email }: { email: string }) {
  const path = usePathname();
  return (
    <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-semibold">AnyGoods</span>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-1.5"
                style={active ? { background: "var(--bg)", fontWeight: 600 } : { color: "var(--muted)" }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <form action="/auth/signout" method="post" className="ml-auto flex items-center gap-3 text-sm">
          <span className="muted hidden sm:inline">{email}</span>
          <button className="muted underline">Salir</button>
        </form>
      </div>
    </header>
  );
}
