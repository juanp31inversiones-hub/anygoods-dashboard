import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LedgerRow = {
  productId: string;
  name: string;
  image: string | null;
  sent: number;          // enviadas a Amazon
  received: number;      // recibidas por Amazon
  sentSource: "amazon" | "app";
  sold: number;          // vendidas (pedidos enviados a clientes)
  returned: number;      // devueltas por clientes
  reimbursed: number;    // perdidas o dañadas que Amazon pagó (neto de las que encontró después)
  reimbursedInbound: number; // de esas, perdidas al recibir el envío (ya no cuentan como recibidas)
  expected: number;      // lo que debería haber en Amazon
  available: number; reserved: number; unfulfillable: number; researching: number;
  amazonNow: number;     // lo que Amazon reporta hoy
  diff: number;          // amazonNow − expected (negativo = faltan)
};

const REIMB = ["WAREHOUSE_LOST", "WAREHOUSE_DAMAGE", "MISSING_FROM_INBOUND", "COMPENSATED_CLAWBACK", "REVERSAL_REIMBURSEMENT"];

/** Cuadre por producto: lo enviado a Amazon contra lo vendido, devuelto, reembolsado y lo que Amazon tiene hoy. */
export async function fbaLedger(supabase: Supabase, onlyActive = true): Promise<LedgerRow[]> {
  const evs: { sku: string; event_type: string; quantity: number | null; total: number; description: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("amazon_financial_events").select("sku, event_type, quantity, total, description")
      .not("sku", "is", null).order("id").range(from, from + 999);
    evs.push(...((data ?? []) as typeof evs));
    if ((data ?? []).length < 1000) break;
  }
  const [{ data: listings }, { data: inv }, { data: inbound }, { data: appItems }] = await Promise.all([
    supabase.from("amazon_listings").select("sku, product_id, products(description, image_url, active)").not("product_id", "is", null),
    supabase.from("amazon_inventory").select("sku, fulfillable, reserved, unfulfillable, researching"),
    supabase.from("amazon_inbound_shipments").select("status, items"),
    supabase.from("fba_shipment_items").select("product_id, qty_shipped, qty_received, fba_shipments(status)"),
  ]);
  type L = { sku: string; product_id: string; products: { description: string; image_url: string | null; active: boolean } | null };
  const ls = (listings ?? []) as unknown as L[];
  const productOf = new Map(ls.map((l) => [l.sku, l.product_id]));
  const rows = new Map<string, LedgerRow>();
  const row = (pid: string) => {
    let r = rows.get(pid);
    if (!r) {
      const l = ls.find((x) => x.product_id === pid);
      r = { productId: pid, name: l?.products?.description ?? "?", image: l?.products?.image_url ?? null, sent: 0, received: 0, sentSource: "app",
        sold: 0, returned: 0, reimbursed: 0, reimbursedInbound: 0, expected: 0, available: 0, reserved: 0, unfulfillable: 0, researching: 0, amazonNow: 0, diff: 0 };
      rows.set(pid, r);
    }
    return r;
  };

  // Enviado y recibido: según Amazon si ya se trajeron los envíos; si no, según los envíos registrados en la app
  const fromAmazon = new Set<string>();
  for (const s of inbound ?? []) {
    if (["CANCELLED", "DELETED", "ERROR", "WORKING"].includes(s.status)) continue;
    for (const it of s.items as { sku: string; shipped: number; received: number }[]) {
      const pid = productOf.get(it.sku);
      if (!pid) continue;
      const r = row(pid);
      r.sent += it.shipped;
      r.received += s.status === "CLOSED" ? it.received : Math.max(it.received, 0);
      r.sentSource = "amazon";
      fromAmazon.add(pid);
    }
  }
  for (const it of (appItems ?? []) as unknown as { product_id: string; qty_shipped: number; qty_received: number | null; fba_shipments: { status: string } | null }[]) {
    const st = it.fba_shipments?.status ?? "";
    if (fromAmazon.has(it.product_id) || ["working", "cancelled"].includes(st)) continue;
    const r = row(it.product_id);
    r.sent += it.qty_shipped;
    r.received += it.qty_received ?? (["receiving", "closed"].includes(st) ? it.qty_shipped : 0);
  }

  for (const e of evs) {
    const pid = productOf.get(e.sku);
    if (!pid) continue;
    const r = row(pid);
    const q = Number(e.quantity ?? 0);
    if (e.event_type === "shipment") r.sold += q;
    else if (e.event_type === "refund") r.returned += q;
    else if (e.event_type === "adjustment" && REIMB.includes(e.description ?? "")) {
      const n = Number(e.total) >= 0 ? q : -q;
      r.reimbursed += n;
      if (e.description === "MISSING_FROM_INBOUND") r.reimbursedInbound += n;
    }
  }
  for (const i of inv ?? []) {
    const pid = productOf.get(i.sku);
    if (!pid) continue;
    const r = row(pid);
    r.available += i.fulfillable; r.reserved += i.reserved; r.unfulfillable += i.unfulfillable; r.researching += i.researching;
  }
  for (const r of rows.values()) {
    r.amazonNow = r.available + r.reserved + r.unfulfillable + r.researching;
    // Si lo recibido viene de Amazon, las perdidas en recepción ya están descontadas ahí
    r.expected = r.received - r.sold + r.returned - r.reimbursed + (r.sentSource === "amazon" ? r.reimbursedInbound : 0);
    r.diff = r.amazonNow - r.expected;
  }
  const active = new Set(ls.filter((l) => l.products?.active).map((l) => l.product_id));
  return [...rows.values()].filter((r) => (!onlyActive || active.has(r.productId)) && (r.sent || r.amazonNow)).sort((a, b) => b.sent - a.sent);
}
