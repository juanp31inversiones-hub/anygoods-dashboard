import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, Scale, Search, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, date, money } from "@/lib/format";
import { PageHeader } from "@/components/ui";

type Txn = {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string | null;
  notes: string | null;
  counterparty: { name: string } | null;
  partner: { short_name: string } | null;
  purchase_order: { po_number: string | null; invoice_number: string | null } | null;
};
type Params = { from?: string; to?: string; cat?: string; type?: string; q?: string; who?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return [
    { label: "Este mes", from: iso(new Date(y, m, 1)), to: "" },
    { label: "Mes pasado", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { label: "Últimos 3 meses", from: iso(new Date(y, m - 2, 1)), to: "" },
    { label: "Este año", from: `${y}-01-01`, to: "" },
    { label: "Año pasado", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
    { label: "Todo", from: "", to: "" },
  ];
}

export default async function Banco({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { from = "", to = "", cat = "", type = "", q = "", who = "" } = sp;
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_transactions")
    .select("id, txn_date, description, amount, category, notes, counterparty:counterparties(name), partner:partners(short_name), purchase_order:purchase_orders(po_number, invoice_number)")
    .order("txn_date", { ascending: true }).order("created_at", { ascending: true })
    .returns<Txn[]>();
  const all = data ?? [];
  const { data: customCats } = await supabase.from("txn_categories").select("key, label");
  const catLabel = (k: string) => CATEGORY_LABELS[k] ?? customCats?.find((c) => c.key === k)?.label ?? k;

  // Saldo después de cada movimiento (sobre todo el historial)
  let running = 0;
  const balanceAfter = new Map(all.map((t) => [t.id, (running += Number(t.amount))]));
  const who_ = (t: Txn) => t.partner?.short_name ?? t.counterparty?.name ?? "";

  const inRange = all.filter((t) => (!from || t.txn_date >= from) && (!to || t.txn_date <= to));
  const term = q.trim().toLowerCase();
  const rows = inRange.filter((t) =>
    (!cat || t.category === cat) &&
    (!who || who_(t) === who) &&
    (!type || (type === "in" ? Number(t.amount) > 0 : Number(t.amount) < 0)) &&
    (!term || [t.description, t.notes, who_(t)].some((v) => v?.toLowerCase().includes(term))),
  ).reverse();

  const sumIn = rows.filter((t) => Number(t.amount) > 0).reduce((a, t) => a + Number(t.amount), 0);
  const sumOut = rows.filter((t) => Number(t.amount) < 0).reduce((a, t) => a + Number(t.amount), 0);
  const opening = all.filter((t) => from && t.txn_date < from).reduce((a, t) => a + Number(t.amount), 0);
  const closing = all.filter((t) => !to || t.txn_date <= to).reduce((a, t) => a + Number(t.amount), 0);

  // Resumen por categoría dentro del rango y filtros (sin el filtro de categoría)
  const base = inRange.filter((t) => (!who || who_(t) === who) && (!type || (type === "in" ? Number(t.amount) > 0 : Number(t.amount) < 0)));
  const byCat = Object.entries(base.reduce<Record<string, number>>((acc, t) => {
    const k = t.category ?? "other_expense";
    acc[k] = (acc[k] ?? 0) + Number(t.amount);
    return acc;
  }, {})).sort((a, b) => a[1] - b[1]);
  const people = [...new Set(all.map(who_).filter(Boolean))].sort();

  const url = (patch: Partial<Params>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/banco${p.size ? `?${p}` : ""}`;
  };
  const activePreset = presets().find((p) => p.from === from && p.to === to)?.label;
  const dateForm = (
<form className="flex flex-wrap gap-2 items-center text-sm">
          {Object.entries(sp).filter(([k]) => !["from", "to"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="date" name="from" defaultValue={from} className="input w-auto py-1" aria-label="Desde" />
          <span className="muted">a</span>
          <input type="date" name="to" defaultValue={to} className="input w-auto py-1" aria-label="Hasta" />
          <button className="btn-ghost py-1">Aplicar</button>
        </form>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Banco" subtitle="Movimientos de Mercury. Filtra por fechas, tipo o categoría; las tarjetas de arriba suman lo filtrado."
        action={{ href: "/banco/nuevo", label: "Nuevo movimiento", icon: Plus }} />

      {/* Rango de fechas */}
      <div className="space-y-2">
      <div className="chips flex flex-wrap gap-2 items-center">
        {presets().map((p) => (
          <Link key={p.label} href={url({ from: p.from, to: p.to })} className="rounded-full px-3 py-1 border text-sm"
            style={activePreset === p.label ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "var(--border)" }}>
            {p.label}
          </Link>
        ))}
      </div>
        <div className="hidden sm:block">{dateForm}</div>
        <details className="sm:hidden text-sm">
          <summary className="muted cursor-pointer">Elegir otras fechas</summary>
          <div className="mt-2">{dateForm}</div>
        </details>
      </div>

      {/* Tarjetas: tocan para filtrar */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Link href={url({ type: type === "in" ? "" : "in" })} className="card p-3 sm:p-4 hover:shadow-sm" style={type === "in" ? { borderColor: "var(--pos)" } : undefined}>
          <div className="muted text-xs flex items-center gap-1"><ArrowDownLeft size={14} className="pos" /> Entradas</div>
          <div className="text-xl sm:text-2xl font-semibold mt-1 tabular-nums pos">{money(sumIn)}</div>
          <div className="muted text-xs">{rows.filter((t) => Number(t.amount) > 0).length} movimientos<span className="hidden sm:inline"> · toca para ver solo entradas</span></div>
        </Link>
        <Link href={url({ type: type === "out" ? "" : "out" })} className="card p-3 sm:p-4 hover:shadow-sm" style={type === "out" ? { borderColor: "var(--neg)" } : undefined}>
          <div className="muted text-xs flex items-center gap-1"><ArrowUpRight size={14} className="neg" /> Salidas</div>
          <div className="text-xl sm:text-2xl font-semibold mt-1 tabular-nums neg">{money(sumOut)}</div>
          <div className="muted text-xs">{rows.filter((t) => Number(t.amount) < 0).length} movimientos<span className="hidden sm:inline"> · toca para ver solo salidas</span></div>
        </Link>
        <div className="card p-3 sm:p-4">
          <div className="muted text-xs flex items-center gap-1"><Scale size={14} /> Neto del periodo</div>
          <div className={`text-xl sm:text-2xl font-semibold mt-1 tabular-nums ${sumIn + sumOut < 0 ? "neg" : "pos"}`}>{money(sumIn + sumOut)}</div>
          <div className="muted text-xs">Entradas − salidas</div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="muted text-xs flex items-center gap-1"><Wallet size={14} /> Saldo {to ? `al ${date(to)}` : "hoy"}</div>
          <div className="text-xl sm:text-2xl font-semibold mt-1 tabular-nums">{money(closing)}</div>
          <div className="muted text-xs">{from ? `Saldo inicial ${money(opening)}` : "Debe coincidir con Mercury"}</div>
        </div>
      </section>

      {/* Por categoría */}
      <section className="card p-4 space-y-2">
        <div className="flex justify-between items-baseline">
          <h2 className="font-semibold text-sm">¿En qué se movió la plata?</h2>
          {cat && <Link href={url({ cat: "" })} className="link text-xs">Quitar filtro de categoría</Link>}
        </div>
        <div className="chips flex flex-wrap gap-2">
          {byCat.map(([k, v]) => (
            <Link key={k} href={url({ cat: cat === k ? "" : k })} className="rounded-lg border px-3 py-1.5 text-sm flex gap-2 items-baseline"
              style={cat === k ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : { borderColor: "var(--border)" }}>
              <span>{catLabel(k)}</span>
              <span className={`tabular-nums font-medium ${v < 0 ? "neg" : "pos"}`}>{money(v)}</span>
            </Link>
          ))}
          {byCat.length === 0 && <span className="muted text-sm">Sin movimientos en este periodo.</span>}
        </div>
      </section>

      {/* Buscar */}
      <form className="card p-3 flex flex-wrap gap-2 items-center">
        {Object.entries(sp).filter(([k]) => !["q", "who"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input name="q" defaultValue={q} placeholder="Buscar descripción o nota" className="input pl-9" />
        </div>
        <select name="who" defaultValue={who} className="input w-auto">
          <option value="">Todos los proveedores / socios</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn-ghost">Buscar</button>
        {(q || who || cat || type || from || to) && <Link href="/banco" className="muted text-sm underline">Limpiar todo</Link>}
      </form>

      {/* Celular: lista compacta */}
      <section className="card sm:hidden divide-y" style={{ borderColor: "var(--border)" }}>
        {rows.map((r) => (
          <Link key={r.id} href={`/banco/${r.id}`} className="flex justify-between gap-3 px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{r.description}</span>
              <span className="block muted text-xs">{date(r.txn_date)} · {r.category ? catLabel(r.category) : "—"}{who_(r) ? ` · ${who_(r)}` : ""}</span>
            </span>
            <span className="text-right shrink-0">
              <span className={`block text-sm font-semibold tabular-nums ${Number(r.amount) < 0 ? "neg" : "pos"}`}>{money(r.amount)}</span>
              <span className="block muted text-xs tabular-nums">{money(balanceAfter.get(r.id))}</span>
            </span>
          </Link>
        ))}
        {rows.length === 0 && <p className="muted text-sm p-4">No hay movimientos con estos filtros.</p>}
      </section>

      <section className="card overflow-x-auto hidden sm:block">
        <table className="data min-w-[860px]">
          <thead>
            <tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Con quién</th><th className="num">Monto</th><th className="num">Saldo</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{date(r.txn_date)}</td>
                <td>
                  <Link href={`/banco/${r.id}`} className="link">{r.description}</Link>
                  {r.purchase_order && <span className="muted text-xs"> · {r.purchase_order.po_number ?? r.purchase_order.invoice_number}</span>}
                  {r.notes && <div className="muted text-xs mt-0.5 line-clamp-1">{r.notes}</div>}
                </td>
                <td className="whitespace-nowrap">{r.category ? catLabel(r.category) : "—"}</td>
                <td>{who_(r) || "—"}</td>
                <td className={`num font-medium ${Number(r.amount) < 0 ? "neg" : "pos"}`}>{money(r.amount)}</td>
                <td className="num muted">{money(balanceAfter.get(r.id))}</td>
                <td><Link href={`/banco/${r.id}`} aria-label="Editar" className="muted hover:underline"><Pencil size={14} /></Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No hay movimientos con estos filtros.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
