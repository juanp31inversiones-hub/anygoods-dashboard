import Link from "next/link";
import { ClipboardCheck, PackageMinus, Plus, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { stockByLocation } from "@/lib/stock";
import { DeleteButton } from "@/components/forms";
import { Badge, PageHeader, RowLink } from "@/components/ui";
import { ReconcileButton } from "@/components/AmazonControls";
import { fbaLedger, type LedgerRow } from "@/lib/fbaLedger";
import { deleteMovement } from "@/lib/actions";
import { LOCATIONS, LOCATION_LABELS, MOVEMENT_LABELS, date, money, units } from "@/lib/format";

const TABS = [
  { key: "stock", label: "Con stock" },
  { key: "empty", label: "Agotados" },
  { key: "all", label: "Todos" },
  { key: "amazon", label: "Cuadre con Amazon" },
];

const OUTSIDE = ["own_warehouse", "supplier_warehouse", "prep_center"];

export default async function Inventario({ searchParams }: { searchParams: Promise<{ tab?: string; product?: string }> }) {
  const { tab = "stock", product = "" } = await searchParams;
  const supabase = await createClient();
  let movesQ = supabase.from("inventory_movements")
    .select("id, movement, qty, location, occurred_on, reference, notes, unit_price, fba_shipment_id, products(id, description)")
    .neq("movement", "purchase").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(product ? 200 : 40);
  if (product) movesQ = movesQ.eq("product_id", product);
  const [all, { data: moves }, { data: amzInv }, { data: listings }, ledger] = await Promise.all([
    stockByLocation(supabase, false),
    movesQ,
    supabase.from("amazon_inventory").select("sku, fulfillable, reserved, unfulfillable, researching"),
    supabase.from("amazon_listings").select("sku, product_id").not("product_id", "is", null),
    tab === "amazon" ? fbaLedger(supabase) : Promise.resolve([] as LedgerRow[]),
  ]);
  // Lo que Amazon reporta hoy por producto (disponible + reservado + no vendible + en investigación)
  const amzSku = new Map((amzInv ?? []).map((i) => [i.sku, i.fulfillable + i.reserved + i.unfulfillable + i.researching]));
  const amazonSays = new Map<string, number>();
  for (const l of listings ?? []) if (amzSku.has(l.sku)) amazonSays.set(l.product_id!, (amazonSays.get(l.product_id!) ?? 0) + amzSku.get(l.sku)!);
  const withStock = all.filter((r) => Number(r.units_on_hand) !== 0);
  const rows = tab === "empty" ? all.filter((r) => Number(r.units_on_hand) === 0) : tab === "all" ? all : withStock;
  // Solo columnas de ubicaciones que tienen o tuvieron stock
  const totalsByLoc: Record<string, number> = Object.fromEntries(LOCATIONS.map((loc) => [loc, withStock.reduce((a, r) => a + (r.stock[loc] ?? 0), 0)]));
  const totalValue = withStock.reduce((a, r) => a + Number(r.inventory_value), 0);

  type M = { id: string; fba_shipment_id: string | null; unit_price: number | null; movement: string; qty: number; location: string; occurred_on: string; reference: string | null; notes: string | null; products: { id: string; description: string } | null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        subtitle={`${withStock.length} productos con stock · ${money(totalValue)} a costo neto`}
        actions={[
          { href: "/envios/nuevo", label: "Enviar a Amazon", icon: Send },
          { href: "/inventario/conteo", label: "Conteo y salidas", icon: ClipboardCheck },
          { href: "/inventario/movimiento", label: "Otro movimiento", icon: Plus },
        ]}
      />

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Fuera de Amazon", value: OUTSIDE.reduce((t, l) => t + (totalsByLoc[l] ?? 0), 0), hint: "En el proveedor, el prep center o tu bodega. Listo para enviar." },
          { label: "Camino a Amazon", value: totalsByLoc.fba_inbound ?? 0, hint: "Enviado, aún no recibido por Amazon." },
          { label: "En Amazon", value: totalsByLoc.amazon_fba ?? 0, hint: "En los centros de Amazon, a la venta." },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className="muted text-xs">{c.label}</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{units(c.value)} <span className="text-sm font-normal muted">und</span></div>
            <div className="muted text-xs mt-1">{c.hint}</div>
          </div>
        ))}
      </section>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/inventario?tab=${t.key}`} className="px-4 py-2 text-sm -mb-px border-b-2"
            style={tab === t.key ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "transparent", color: "var(--muted)" }}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "amazon" ? <AmazonLedger rows={ledger} /> : (
      <section className="card overflow-x-auto">
        <table className="data min-w-[900px]">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Fuera de Amazon</th><th className="num">Camino a Amazon</th><th className="num">En Amazon</th>
              <th className="num">Total</th><th className="num">Costo neto/u</th><th className="num">Valor</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = Number(r.units_on_hand) === 0;
              const notInFba = (r.stock.amazon_fba ?? 0) === 0 && !empty;
              return (
                <tr key={r.product_id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: "var(--bg)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.image_url && <img src={r.image_url} alt="" className="w-full h-full object-contain" />}
                      </div>
                      <div>
                        <Link href={`/productos/${r.product_id}`} className="link">{r.description}</Link>
                        <div className="flex gap-1 mt-0.5 items-center">
                          <span className="muted text-xs">{r.asin ?? ""}</span>
                          {empty && <Badge>Agotado</Badge>}
                          {!r.active && <Badge tone="muted">Inactivo</Badge>}
                          {notInFba && <Badge tone="warn">Sin stock en Amazon</Badge>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num">
                    {units(OUTSIDE.reduce((t, loc) => t + (r.stock[loc] ?? 0), 0))}
                    <div className="muted text-xs">{OUTSIDE.filter((loc) => (r.stock[loc] ?? 0) !== 0).map((loc) => `${LOCATION_LABELS[loc]}: ${units(r.stock[loc])}`).join(" · ")}</div>
                  </td>
                  <td className={`num ${(r.stock.fba_inbound ?? 0) === 0 ? "muted" : ""}`}>{units(r.stock.fba_inbound ?? 0)}</td>
                  <td className="num">
                    {units(r.stock.amazon_fba ?? 0)}
                    {amazonSays.has(r.product_id) && amazonSays.get(r.product_id) !== (r.stock.amazon_fba ?? 0) && (
                      <div className="text-xs mt-0.5 space-y-1">
                        <div className="neg">Amazon dice {units(amazonSays.get(r.product_id))}</div>
                        <ReconcileButton productId={r.product_id} label="Cuadrar" />
                      </div>
                    )}
                  </td>
                  <td className="num font-medium">{units(r.units_on_hand)}</td>
                  <td className="num">{r.avg_cost ? money(r.avg_cost) : "—"}</td>
                  <td className="num">{money(r.inventory_value)}</td>
                  <td>
                    {!empty && (
                      <div className="flex gap-1">
                        {Object.entries(r.stock).some(([loc, q]) => loc !== "amazon_fba" && q > 0) && (
                          <RowLink href={`/envios/nuevo?product=${r.product_id}`} label="Enviar a Amazon" icon={Send} tone="primary" />
                        )}
                        <RowLink href={`/inventario/conteo?product=${r.product_id}`} label="Dar salida" icon={PackageMinus} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">No hay productos en esta vista. Las compras que registres aparecerán aquí.</td></tr>}
          </tbody>
        </table>
      </section>
      )}

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap justify-between items-end gap-2 px-4 pt-4">
          <div>
            <h2 className="font-semibold">Historial: ventas, envíos, salidas y ajustes</h2>
            <p className="muted text-xs">{product ? "Todos los movimientos del producto elegido." : "Los 40 más recientes. Elige un producto para ver su historia completa."}</p>
          </div>
          <form className="flex gap-2">
            <input type="hidden" name="tab" value={tab} />
            <select name="product" defaultValue={product} className="input w-auto text-sm">
              <option value="">Todos los productos</option>
              {all.map((r) => <option key={r.product_id} value={r.product_id}>{r.description}</option>)}
            </select>
            <button className="btn-ghost text-sm">Ver</button>
          </form>
        </div>
        <table className="data mt-2">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Ubicación</th><th>Referencia</th><th className="num">Cantidad</th><th /></tr></thead>
          <tbody>
            {((moves ?? []) as unknown as M[]).map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{date(m.occurred_on)}</td>
                <td>{m.products?.description}</td>
                <td>{MOVEMENT_LABELS[m.movement] ?? m.movement}</td>
                <td>{LOCATION_LABELS[m.location] ?? m.location}</td>
                <td className="muted">
                  {m.fba_shipment_id ? <Link href={`/envios/${m.fba_shipment_id}`} className="link">{m.reference}</Link> : m.reference}
                  {m.unit_price != null && <span className="font-medium" style={{ color: "var(--text)" }}> · {money(m.unit_price)}/u = {money(Math.abs(m.qty) * Number(m.unit_price))}</span>}
                  {m.notes ? ` · ${m.notes}` : ""}
                </td>
                <td className={`num ${m.qty < 0 ? "neg" : "pos"}`}>{m.qty > 0 ? "+" : ""}{units(m.qty)}</td>
                <td>{!m.fba_shipment_id && <DeleteButton action={deleteMovement.bind(null, m.id)} label="✕" confirmText="¿Eliminar este movimiento?" />}</td>
              </tr>
            ))}
            {(moves ?? []).length === 0 && <tr><td colSpan={7} className="muted">Sin movimientos todavía.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AmazonLedger({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length) return <p className="muted text-sm">No hay productos activos con envíos a Amazon. Sincroniza en la página Amazon.</p>;
  const line = (label: string, v: number, sign: "+" | "−" | "=" | "", strong = false, hint?: string) => (
    <tr className={strong ? "font-semibold" : ""}>
      <td className={strong ? "" : "muted"}>{sign} {label}{hint && <div className="text-xs muted font-normal">{hint}</div>}</td>
      <td className="num">{units(v)}</td>
    </tr>
  );
  return (
    <div className="space-y-3">
      <p className="muted text-sm">Para cada producto: lo que mandaste a Amazon, menos lo vendido, más las devoluciones, menos lo que Amazon perdió y pagó. Eso es lo que debería tener Amazon; abajo, lo que Amazon reporta hoy.</p>
      <div className="grid lg:grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.productId} className="card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded shrink-0 overflow-hidden" style={{ background: "var(--bg)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.image && <img src={r.image} alt="" className="w-full h-full object-contain" />}
              </span>
              <Link href={`/productos/${r.productId}`} className="font-medium link">{r.name}</Link>
            </div>
            <table className="data text-sm">
              <tbody>
                {line("Enviadas a Amazon", r.sent, "", false, r.sentSource === "amazon" ? "Según los envíos en Amazon" : "Según los envíos registrados en la app")}
                {r.sent !== r.received && line("Amazon no las recibió", r.sent - r.received, "−")}
                {line("Vendidas", r.sold, "−")}
                {r.returned > 0 && line("Devueltas por clientes", r.returned, "+")}
                {r.reimbursed !== 0 && line("Perdidas o dañadas que Amazon pagó", r.reimbursed - (r.sentSource === "amazon" ? r.reimbursedInbound : 0), "−")}
                {line("Debería tener Amazon", r.expected, "=", true)}
                {line("Amazon reporta hoy", r.amazonNow, "", true,
                  `Disponible ${r.available} · Reservado ${r.reserved} · No vendible ${r.unfulfillable} · En investigación ${r.researching}`)}
              </tbody>
            </table>
            {r.diff < 0 ? (
              <div className="rounded-lg p-3 text-sm space-y-1" style={{ background: "var(--neg-soft)" }}>
                <b className="neg">Faltan {units(-r.diff)} unidades.</b>
                <p>{r.sent !== r.received ? "Amazon recibió menos de lo enviado. " : ""}Abre un caso en Seller Central → Help → Fulfillment by Amazon → <i>Investigate inventory</i> (o <i>Investigate shipment</i> si fue en la recepción) y pide el reembolso.</p>
                {r.researching > 0 && <p className="muted text-xs">{r.researching} ya están “en investigación” por Amazon.</p>}
              </div>
            ) : r.diff > 0 ? (
              <div className="rounded-lg p-3 text-sm" style={{ background: "var(--warn-soft)" }}>Amazon tiene {units(r.diff)} unidades más de las esperadas (por ejemplo, devoluciones que aún no se reembolsan).</div>
            ) : (
              <div className="rounded-lg p-3 text-sm pos" style={{ background: "var(--pos-soft)" }}>Cuadra exacto.</div>
            )}
          </div>
        ))}
      </div>
      <p className="muted text-xs">“Reservado” son unidades de pedidos que Amazon está preparando o que mueve entre sus centros: siguen siendo tuyas. Las ventas cuentan cuando Amazon envía el pedido.</p>
    </div>
  );
}
