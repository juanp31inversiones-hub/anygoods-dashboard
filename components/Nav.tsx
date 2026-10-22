"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Boxes, KeyRound, Landmark, LayoutDashboard, LogOut, Menu, Package, Send, ShoppingCart, Store, Truck, X } from "lucide-react";

/** Barra inferior del celular: lo que se usa a diario; el resto va en "Más". */
const TABS = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/amazon", label: "Amazon", icon: Store },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/banco", label: "Banco", icon: Landmark },
];
const MORE = [
  { href: "/envios", label: "Envíos a Amazon", icon: Send },
  { href: "/compras", label: "Compras", icon: ShoppingCart },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/proveedores", label: "Proveedores y clientes", icon: Truck },
  { href: "/cuenta", label: "Mi cuenta y contraseña", icon: KeyRound },
];
const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

const GROUPS = [
  { title: "", links: [{ href: "/", label: "Resumen", icon: LayoutDashboard }] },
  { title: "Operación", links: [
    { href: "/inventario", label: "Inventario", icon: Boxes },
    { href: "/envios", label: "Envíos a Amazon", icon: Send },
    { href: "/compras", label: "Compras", icon: ShoppingCart },
  ] },
  { title: "Dinero", links: [
    { href: "/amazon", label: "Amazon", icon: Store },
    { href: "/banco", label: "Banco", icon: Landmark },
  ] },
  { title: "Catálogo", links: [
    { href: "/productos", label: "Productos", icon: Package },
    { href: "/proveedores", label: "Proveedores y clientes", icon: Truck },
  ] },
];

function NavLinks({ compact }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g.title || "home"} className={compact ? "contents" : "flex flex-col gap-1"}>
          {!compact && g.title && <div className="muted text-[11px] uppercase tracking-wide px-3 pt-4 pb-1">{g.title}</div>}
          {g.links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg text-sm transition-colors ${compact ? "px-3 py-2 shrink-0" : "px-3 py-2.5"}`}
                style={active ? { background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : { color: "var(--muted)" }}
              >
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function Sidebar({ email }: { email: string }) {
  return (
    <>
      {/* Escritorio */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r sticky top-0 h-screen p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <Link href="/" className="px-3 pb-6 pt-1 block">
          <Logo className="h-11" />
        </Link>
        <nav className="flex flex-col gap-1"><NavLinks /></nav>
        <form action="/auth/signout" method="post" className="mt-auto px-3 pt-4 border-t text-xs" style={{ borderColor: "var(--border)" }}>
          <div className="muted truncate mb-2">{email}</div>
          <Link href="/cuenta" className="flex items-center gap-2 muted hover:underline mb-2"><KeyRound size={14} /> Mi cuenta y contraseña</Link>
          <button className="flex items-center gap-2 muted hover:underline"><LogOut size={14} /> Cerrar sesión</button>
        </form>
      </aside>

      {/* Móvil: encabezado simple + barra inferior tipo app */}
      <MobileNav />
    </>
  );
}

function MobileNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const moreActive = MORE.some((m) => isActive(path, m.href));
  return (
    <>
      <header className="md:hidden sticky top-0 z-20 border-b px-4 h-12 flex items-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <Link href="/" aria-label="Inicio"><Logo className="h-6" /></Link>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-30" onClick={() => setOpen(false)} style={{ background: "rgba(0,0,0,.35)" }}>
          <div className="absolute bottom-0 inset-x-0 rounded-t-2xl p-3 pb-24 space-y-1" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            {MORE.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[15px]"
                style={isActive(path, href) ? { background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : undefined}>
                <Icon size={20} /> {label}
              </Link>
            ))}
            <form action="/auth/signout" method="post">
              <button className="flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] muted w-full"><LogOut size={20} /> Cerrar sesión</button>
            </form>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t grid grid-cols-5"
        style={{ borderColor: "var(--border)", background: "var(--surface)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href) && !open;
          return (
            <Link key={href} href={href} className="flex flex-col items-center gap-0.5 py-2 text-[11px]"
              style={{ color: active ? "var(--accent)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>
              <Icon size={22} strokeWidth={active ? 2.25 : 1.75} /> {label}
            </Link>
          );
        })}
        <button onClick={() => setOpen((o) => !o)} className="flex flex-col items-center gap-0.5 py-2 text-[11px]"
          style={{ color: open || moreActive ? "var(--accent)" : "var(--muted)", fontWeight: open || moreActive ? 600 : 400 }}>
          {open ? <X size={22} /> : <Menu size={22} />} Más
        </button>
      </nav>
    </>
  );
}
