"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Boxes, KeyRound, Landmark, LayoutDashboard, LogOut, Package, Send, ShoppingCart, Store, Truck } from "lucide-react";

const LINKS = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/envios", label: "Envíos FBA", icon: Send },
  { href: "/amazon", label: "Amazon", icon: Store },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/compras", label: "Compras", icon: ShoppingCart },
  { href: "/banco", label: "Banco", icon: Landmark },
  { href: "/proveedores", label: "Proveedores", icon: Truck },
];

function NavLinks({ compact }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, icon: Icon }) => {
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

      {/* Móvil */}
      <header className="md:hidden sticky top-0 z-10 border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-center justify-between px-4 pt-3">
          <Link href="/"><Logo className="h-7" /></Link>
          <div className="flex items-center gap-4">
            <Link href="/cuenta" aria-label="Mi cuenta" className="muted"><KeyRound size={18} /></Link>
            <form action="/auth/signout" method="post"><button aria-label="Cerrar sesión" className="muted"><LogOut size={18} /></button></form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 py-2"><NavLinks compact /></nav>
      </header>
    </>
  );
}
