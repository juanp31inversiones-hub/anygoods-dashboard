import Link from "next/link";
import { CheckCircle2, Circle, Plus, Receipt, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader } from "@/components/ui";
import { STATUS_LABELS, date, money, units } from "@/lib/format";

type PO = {
  id: string;
  po_number: string | null;
  invoice_number: string | null;
  purchase_date: string;
  status: string;
  supplier: { id: string; name: string } | null;
  purchase_order_lines: { units: number; unit_cost: number; products: { description: string; image_url: string | null } | null }[];
  additional_costs: { amount: number }[];
  po_documents: { doc_type: string }[];
};

const STATUS_TONE: Record<string, "muted" | "warn" | "pos" | "neg"> = {
  draft: "muted", ordered: "warn", received: "pos", sent_to_amazon: "pos", closed: "muted", cancelled: "neg",
};
const DOCS = [["our_po", "PO"], ["supplier_invoice", "Invoice"], ["payment_proof", "Pago"]] as const;

export default async function Compras({ searchParams }: {
  searchParams: Promise<{ q?: string; supplier?: string; status?: string; year?: string }>;
}) {
  const { q = "", supplier = "", status = "", year = "" } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, invoice_number, purchase_date, status, supplier:counterparties!purchase_orders_supplier_id_fkey(id, name), purchase_order_lines(units, unit_cost, products(description, image_url)), additional_costs(amount), po_documents(doc_type)",
    )
    .is("additional_costs.moved_to_shipment_id", null)
    .order("purchase_date", { ascending: false })
    .returns<PO[]>();
  const all = data ?? [];

  const net = (po: PO) => po.purchase_order_lines.reduce((a, l) => a + l.units * Number(l.unit_cost), 0);
  const extra = (po: PO) => po.additional_costs.reduce((a, c) => a + Number(c.amount), 0);
  const unitsOf = (po: PO) => po.purchase_order_lines.reduce((a, l) => a + l.units, 0);

  const term = q.trim().toLowerCase();
  const rows = all.filter((po) =>
    (!supplier || po.supplier?.id === supplier) &&
    (!status || po.status === status) &&
    (!year || po.purchase_date.startsWith(year)) &&
    (!term || [po.po_number, po.invoice_number, po.supplier?.name, ...po.purchase_order_lines.map((l) => l.products?.description)]
      .some((v) => v?.toLowerCase().includes(term))),
  );

  const suppliers = [...new Map(all.filter((p) => p.supplier).map((p) => [p.supplier!.id, p.supplier!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const years = [...new Set(all.map((p) => p.purchase_date.slice(0, 4)))].sort().reverse();
  const totNet = rows.reduce((a, p) => a + net(p), 0);
  const totExtra = rows.reduce((a, p) => a + extra(p), 0);
  const totUnits = rows.reduce((a, p) => a + unitsOf(p), 0);
  const missingDocs = rows.filter((p) => !p.po_documents.some((d) => d.doc_type === "supplier_invoice") || !p.po_documents.some((d) => d.doc_type === "payment_proof")).length;
  const filtered = !!(q || supplier || status || year);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        subtitle="Órdenes a proveedores: compra neta + costos del proveedor. Los costos de Amazon van en Envíos FBA."
        actions={[
          { href: "/compras/nueva", label: "Nueva compra", icon: Plus },
          { href: "/compras/costos", label: "Costos adicionales", icon: Receipt },
        ]}
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Compras</div><div className="text-2xl font-semibold mt-1">{rows.length}</div><div className="muted text-xs">{units(totUnits)} unidades</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Compra neta</div><div className="text-2xl font-semibold mt-1 tabular-nums">{money(totNet)}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">+ Costos del proveedor</div><div className="text-2xl font-semibold mt-1 tabular-nums">{money(totExtra)}</div><div className="muted text-xs">{totNet ? `${((totExtra / totNet) * 100).toFixed(1)}% sobre la compra` : ""}</div></div>
        <div className="card p-4"><div className="muted text-xs uppercase tracking-wide">Documentos pendientes</div><div className={`text-2xl font-semibold mt-1 ${missingDocs ? "neg" : ""}`}>{missingDocs}</div><div className="muted text-xs">compras sin invoice o sin pago</div></div>
      </section>

      <form className="card p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input name="q" defaultValue={q} placeholder="Buscar PO, factura, proveedor o producto" className="input pl-9" />
        </div>
        <select name="supplier" defaultValue={supplier} className="input w-auto">
          <option value="">Todos los proveedores</option>
          {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="year" defaultValue={year} className="input w-auto">
          <option value="">Todos los años</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn-ghost">Filtrar</button>
        {filtered && <Link href="/compras" className="muted text-sm underline">Limpiar</Link>}
      </form>

      <section className="card overflow-x-auto">
        <table className="data min-w-[1050px]">
          <thead>
            <tr>
              <th>Fecha</th><th>PO</th><th>Factura</th><th>Proveedor</th><th>Productos</th>
              <th className="num">Unidades</th><th className="num">Compra neta</th><th className="num">Costos</th><th className="num">Total</th>
              <th>Documentos</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((po) => {
              const first = po.purchase_order_lines[0]?.products;
              const more = po.purchase_order_lines.length - 1;
              const href = `/compras/${po.id}`;
              return (
                <tr key={po.id} className="hover:bg-[var(--bg)]">
                  <td className="whitespace-nowrap"><Link href={href} className="block">{date(po.purchase_date)}</Link></td>
                  <td className="whitespace-nowrap"><Link href={href} className="link font-medium">{po.po_number ?? <span className="muted font-normal">Sin PO</span>}</Link></td>
                  <td className="whitespace-nowrap">{po.invoice_number ?? <span className="muted">—</span>}</td>
                  <td>{po.supplier?.name}</td>
                  <td className="max-w-[280px]">
                    <Link href={href} className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: "var(--bg)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {first?.image_url && <img src={first.image_url} alt="" className="w-full h-full object-contain" />}
                      </span>
                      <span className="leading-snug">
                        <span className="line-clamp-1">{first?.description ?? "—"}</span>
                        {more > 0 && <span className="muted text-xs">+{more} producto{more === 1 ? "" : "s"} más</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="num">{units(unitsOf(po))}</td>
                  <td className="num">{money(net(po))}</td>
                  <td className="num muted">{extra(po) ? money(extra(po)) : "—"}</td>
                  <td className="num font-semibold">{money(net(po) + extra(po))}</td>
                  <td>
                    <span className="flex gap-2 text-xs whitespace-nowrap">
                      {DOCS.map(([t, l]) => {
                        const has = po.po_documents.some((d) => d.doc_type === t);
                        return (
                          <span key={t} className={`inline-flex items-center gap-0.5 ${has ? "" : "muted"}`} title={has ? `${l} adjunto` : `Falta ${l}`}>
                            {has ? <CheckCircle2 size={13} className="pos" /> : <Circle size={13} />}{l}
                          </span>
                        );
                      })}
                    </span>
                  </td>
                  <td><Badge tone={STATUS_TONE[po.status]}>{STATUS_LABELS[po.status] ?? po.status}</Badge></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={11} className="muted">{filtered ? "No hay compras con esos filtros." : "Aún no hay compras."}</td></tr>}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5}>Total ({rows.length} compras)</td>
                <td className="num">{units(totUnits)}</td>
                <td className="num">{money(totNet)}</td>
                <td className="num">{money(totExtra)}</td>
                <td className="num">{money(totNet + totExtra)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}
