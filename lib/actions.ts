"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const done = (path: string, msg: string): never => redirect(`${path}?ok=${encodeURIComponent(msg)}`);

export type ActionState = { error?: string; id?: string } | undefined;

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === null ? null : Number(v);
};

function friendly(error: { code?: string; message: string }) {
  if (error.code === "23503") return "No se puede eliminar: tiene compras, movimientos o pagos asociados. Desactívalo en su lugar.";
  if (error.code === "23505") return "Ya existe un registro con ese valor (UPC, nombre o correo duplicado).";
  return error.message;
}

// ===== Productos =====
export async function saveProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = {
    description: str(fd, "description"),
    brand: str(fd, "brand"),
    asin: str(fd, "asin")?.toUpperCase() ?? null,
    upc: str(fd, "upc"),
    sku: str(fd, "sku"),
    units_per_case: num(fd, "units_per_case"),
    retail_price: num(fd, "retail_price"),
    image_url: str(fd, "image_url"),
    notes: str(fd, "notes"),
    active: fd.get("active") === "on",
  };
  if (!row.description) return { error: "La descripción es obligatoria." };
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert(row);
  if (error) return { error: friendly(error) };
  revalidatePath("/productos");
  revalidatePath("/inventario");
  done("/productos", id ? "Producto actualizado" : "Producto creado");
}

export async function deleteProduct(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  revalidatePath("/productos");
  done("/productos", "Producto eliminado");
}

// ===== Proveedores y contrapartes =====
export async function saveCounterparty(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = {
    name: str(fd, "name"),
    kind: str(fd, "kind") ?? "supplier",
    contact_name: str(fd, "contact_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    website: str(fd, "website"),
    notes: str(fd, "notes"),
  };
  if (!row.name) return { error: "El nombre es obligatorio." };
  const { error } = id
    ? await supabase.from("counterparties").update(row).eq("id", id)
    : await supabase.from("counterparties").insert(row);
  if (error) return { error: friendly(error) };
  revalidatePath("/proveedores");
  done("/proveedores", id ? "Proveedor actualizado" : "Proveedor creado");
}

export async function deleteCounterparty(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("counterparties").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  revalidatePath("/proveedores");
  done("/proveedores", "Proveedor eliminado");
}

// ===== Órdenes de compra =====
export type POLine = { id?: string; product_id: string; cases: string; units: string; unit_cost: string; location?: string };
export type POCost = {
  id?: string;
  cost_type: string;
  description: string;
  amount: string;
  product_id: string; // "" = toda la orden
  allocation: "units" | "value";
  cost_date: string;
  counterparty_id: string;
};
export type POPayload = {
  id?: string;
  supplier_id: string;
  paid_via_id: string;
  po_number: string;
  invoice_number: string;
  purchase_date: string;
  arrival_date: string;
  status: string;
  notes: string;
  location: string;
  lines: POLine[];
  costs: POCost[];
};

export async function savePurchaseOrder(p: POPayload): Promise<ActionState> {
  if (!p.supplier_id) return { error: "Selecciona el proveedor." };
  if (!p.purchase_date) return { error: "La fecha de compra es obligatoria." };
  if (!p.lines.length) return { error: "Agrega al menos un producto." };
  for (const l of p.lines) {
    if (!l.product_id || !(Number(l.units) > 0) || l.unit_cost === "" || Number(l.unit_cost) < 0)
      return { error: "Cada línea necesita producto, unidades mayores a 0 y costo unitario." };
  }
  for (const c of p.costs) {
    if (!c.cost_type || c.amount === "" || Number.isNaN(Number(c.amount)))
      return { error: "Cada costo adicional necesita tipo y monto." };
    if (c.product_id && !p.lines.some((l) => l.product_id === c.product_id))
      return { error: "Un costo está asignado a un producto que no está en la orden." };
  }

  const supabase = await createClient();
  if (p.id) {
    // No permitir mover la llegada de una línea si ya se enviaron unidades desde esa ubicación.
    const changed = p.lines.filter((l) => l.id && l.location);
    if (changed.length) {
      const { data: purchases } = await supabase.from("inventory_movements").select("po_line_id, product_id, location, qty")
        .eq("movement", "purchase").in("po_line_id", changed.map((l) => l.id!));
      for (const m of purchases ?? []) {
        const line = changed.find((l) => l.id === m.po_line_id);
        if (!line || line.location === m.location) continue;
        const { data: atOld } = await supabase.from("inventory_movements").select("qty").eq("product_id", m.product_id).eq("location", m.location);
        const remaining = (atOld ?? []).reduce((a, r) => a + r.qty, 0) - m.qty;
        if (remaining < 0)
          return { error: "Ya hay envíos o salidas desde la ubicación original de un producto de esta compra. Corrige primero esos envíos o deja la ubicación como estaba." };
      }
    }
    // Borra las líneas que se quitaron del formulario (y sus movimientos de inventario).
    const { data: existing } = await supabase.from("purchase_order_lines").select("id").eq("purchase_order_id", p.id);
    const keep = new Set(p.lines.map((l) => l.id).filter(Boolean));
    const removed = (existing ?? []).map((r) => r.id).filter((id) => !keep.has(id));
    if (removed.length) {
      const m = await supabase.from("inventory_movements").delete().in("po_line_id", removed);
      if (m.error) return { error: friendly(m.error) };
      const l = await supabase.from("purchase_order_lines").delete().in("id", removed);
      if (l.error) return { error: friendly(l.error) };
    }
    // Costos adicionales quitados del formulario
    const { data: existingCosts } = await supabase.from("additional_costs").select("id").eq("purchase_order_id", p.id).is("moved_to_shipment_id", null);
    const keepCosts = new Set(p.costs.map((c) => c.id).filter(Boolean));
    const removedCosts = (existingCosts ?? []).map((r) => r.id).filter((id) => !keepCosts.has(id));
    if (removedCosts.length) {
      const c = await supabase.from("additional_costs").delete().in("id", removedCosts);
      if (c.error) return { error: friendly(c.error) };
    }
  }
  const { data, error } = await supabase.rpc("save_purchase_order", { p });
  if (error) return { error: friendly(error) };
  revalidatePath("/compras");
  revalidatePath("/inventario");
  revalidatePath("/");
  return { id: data as string };
}

export async function deletePurchaseOrder(id: string): Promise<ActionState> {
  const supabase = await createClient();
  // Archivos adjuntos de la orden (las filas se borran en cascada con la orden)
  const { data: docs } = await supabase.from("po_documents").select("file_path").eq("purchase_order_id", id);
  if (docs?.length) await supabase.storage.from("po-documents").remove(docs.map((d) => d.file_path));
  const { data: lines } = await supabase.from("purchase_order_lines").select("id").eq("purchase_order_id", id);
  const ids = (lines ?? []).map((l) => l.id);
  const steps = [
    () => supabase.from("bank_transactions").update({ purchase_order_id: null }).eq("purchase_order_id", id),
    () => (ids.length ? supabase.from("inventory_movements").delete().in("po_line_id", ids) : Promise.resolve({ error: null })),
    () => supabase.from("purchase_orders").delete().eq("id", id),
  ];
  for (const step of steps) {
    const { error } = await step();
    if (error) return { error: friendly(error) };
  }
  revalidatePath("/compras");
  revalidatePath("/inventario");
  done("/compras", "Orden eliminada");
}

// ===== Banco =====
export async function saveTransaction(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const amount = num(fd, "amount");
  if (!amount || amount <= 0) return { error: "El monto debe ser mayor a 0." };
  const direction = fd.get("direction") === "out" ? "out" : "in";
  const sign = direction === "out" ? -1 : 1;

  // Categoría nueva escrita por el usuario
  let category = str(fd, "category");
  const newCategory = str(fd, "new_category");
  if (newCategory) {
    const { data: key, error } = await supabase.rpc("add_txn_category", { p_label: newCategory, p_direction: direction });
    if (error) return { error: friendly(error) };
    category = key as string;
  }
  // A quién se pagó / quién pagó: si no existe, se crea
  let counterpartyId = str(fd, "counterparty_id");
  const cpName = str(fd, "counterparty_name");
  if (!counterpartyId && cpName) {
    const { data: found } = await supabase.from("counterparties").select("id").ilike("name", cpName).limit(1).maybeSingle();
    if (found) counterpartyId = found.id;
    else {
      const kind = category === "inventory" ? "supplier" : direction === "in" ? "customer" : "service";
      const { data: created, error } = await supabase.from("counterparties").insert({ name: cpName, kind }).select("id").single();
      if (error) return { error: friendly(error) };
      counterpartyId = created.id;
    }
  }
  const partnerId = str(fd, "partner_id");
  if ((category === "capital_contribution" || category === "capital_return") && !partnerId) return { error: "Elige de qué socio es." };

  const row = {
    bank_account_id: str(fd, "bank_account_id"),
    txn_date: str(fd, "txn_date"),
    description: str(fd, "description") ?? str(fd, "auto_description"),
    amount: sign * amount,
    category,
    counterparty_id: counterpartyId,
    partner_id: partnerId,
    purchase_order_id: str(fd, "purchase_order_id"),
    notes: str(fd, "notes"),
  };
  if (!row.txn_date || !row.description || !row.bank_account_id) return { error: "Falta la fecha o una descripción." };
  const { error } = id
    ? await supabase.from("bank_transactions").update(row).eq("id", id)
    : await supabase.from("bank_transactions").insert(row);
  if (error) return { error: friendly(error) };
  revalidatePath("/banco");
  revalidatePath("/");
  done("/banco", id ? "Movimiento actualizado" : "Movimiento registrado");
}

export async function deleteTransaction(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_transactions").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  revalidatePath("/banco");
  revalidatePath("/");
  done("/banco", "Movimiento eliminado");
}

// ===== Inventario =====
const OUTBOUND = new Set(["sale", "removal", "liquidation", "damaged", "reimbursed"]);

export async function saveMovement(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const movement = str(fd, "movement");
  const product_id = str(fd, "product_id");
  const qty = num(fd, "qty");
  const location = str(fd, "location") ?? "amazon_fba";
  const base = {
    product_id,
    occurred_on: str(fd, "occurred_on"),
    unit_price: num(fd, "unit_price"),
    reference: str(fd, "reference"),
    notes: str(fd, "notes"),
    channel: str(fd, "channel"),
  };
  if (!movement || !product_id || !qty || !base.occurred_on) return { error: "Producto, tipo, cantidad y fecha son obligatorios." };

  let rows;
  if (movement === "transfer") {
    const to = str(fd, "to_location");
    if (!to || to === location) return { error: "Elige un destino distinto al origen." };
    const q = Math.abs(qty);
    rows = [
      { ...base, movement, qty: -q, location },
      { ...base, movement, qty: q, location: to },
    ];
  } else {
    const signed = movement === "adjustment" ? qty : OUTBOUND.has(movement) ? -Math.abs(qty) : Math.abs(qty);
    rows = [{ ...base, movement, qty: signed, location }];
  }
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { error: friendly(error) };
  revalidatePath("/inventario");
  revalidatePath("/productos");
  done("/inventario", "Movimiento de inventario registrado");
}

export async function deleteMovement(id: string): Promise<ActionState> {
  const supabase = await createClient();
  // Las compras y los envíos FBA gestionan sus propios movimientos.
  const { error } = await supabase.from("inventory_movements").delete().eq("id", id).neq("movement", "purchase").is("fba_shipment_id", null);
  if (error) return { error: friendly(error) };
  revalidatePath("/inventario");
  return undefined;
}

// ===== Conteo y salidas de inventario =====
export type StockCountPayload = {
  date: string;
  reason: string;
  notes: string;
  deactivate: boolean;
  collected_by?: string; // tercero que cobró la venta/liquidación por nosotros
  entries: { product_id: string; location: string; diff: number; unit_price?: number | null }[];
};

const EXIT_REASONS = new Set(["sale", "liquidation", "damaged", "removal", "adjustment"]);

/** Registra la diferencia entre lo que dice el sistema y lo que realmente hay. */
export async function applyStockCount(p: StockCountPayload): Promise<ActionState> {
  const entries = p.entries.filter((e) => e.diff !== 0);
  if (!entries.length) return { error: "No hay cambios: la cantidad real es igual a la del sistema." };
  if (!EXIT_REASONS.has(p.reason)) return { error: "Motivo no válido." };
  if (!p.date) return { error: "La fecha es obligatoria." };

  const supabase = await createClient();
  const rows = entries.map((e) => ({
    product_id: e.product_id,
    location: e.location,
    qty: e.diff,
    // Las salidas toman el motivo elegido; si sobran unidades es un ajuste positivo.
    movement: e.diff < 0 ? p.reason : "adjustment",
    occurred_on: p.date,
    reference: p.reason === "liquidation" ? "Liquidación" : p.reason === "sale" ? "Venta" : "Conteo de inventario",
    unit_price: e.diff < 0 && e.unit_price != null ? e.unit_price : null,
    channel: p.reason === "liquidation" ? "liquidacion" : null,
    notes: p.notes || null,
  }));
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { error: friendly(error) };

  // Venta o liquidación cobrada por un tercero: queda como dinero nuestro en su poder
  const proceeds = entries.reduce((a, e) => a + (e.diff < 0 && e.unit_price ? -e.diff * e.unit_price : 0), 0);
  if (p.collected_by && proceeds > 0) {
    const units = entries.reduce((a, e) => a + (e.diff < 0 ? -e.diff : 0), 0);
    const { error: aeErr } = await supabase.from("agent_entries").insert({
      counterparty_id: p.collected_by, entry_date: p.date, kind: p.reason === "liquidation" ? "liquidation" : "other_income",
      amount: Math.round(proceeds * 100) / 100,
      description: `${p.reason === "liquidation" ? "Liquidación" : "Venta"} de ${units} und cobrada a nuestro favor${p.notes ? ` · ${p.notes}` : ""}`,
    });
    if (aeErr) return { error: friendly(aeErr) };
  }

  let deactivated = 0;
  if (p.deactivate) {
    const ids = [...new Set(entries.map((e) => e.product_id))];
    const { data } = await supabase.from("v_inventory_on_hand").select("product_id, units_on_hand").in("product_id", ids);
    const empty = (data ?? []).filter((r) => Number(r.units_on_hand) === 0).map((r) => r.product_id);
    if (empty.length) {
      await supabase.from("products").update({ active: false }).in("id", empty);
      deactivated = empty.length;
    }
  }
  revalidatePath("/inventario");
  revalidatePath("/productos");
  revalidatePath("/");
  const out = entries.filter((e) => e.diff < 0).reduce((a, e) => a - e.diff, 0);
  done("/inventario", `Inventario actualizado: ${out} unidades dadas de salida` + (deactivated ? `, ${deactivated} productos marcados como inactivos` : ""));
}

// ===== Costos adicionales sueltos (agregados después de la compra) =====
export async function saveCost(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const amount = num(fd, "amount");
  const row = {
    purchase_order_id: str(fd, "purchase_order_id"),
    product_id: str(fd, "product_id"),
    cost_type: str(fd, "cost_type"),
    description: str(fd, "description"),
    amount: amount === null ? null : (fd.get("cost_type") === "supplier_discount" ? -Math.abs(amount) : amount),
    allocation: str(fd, "allocation") ?? "units",
    cost_date: str(fd, "cost_date"),
    counterparty_id: str(fd, "counterparty_id"),
    bank_transaction_id: str(fd, "bank_transaction_id"),
  };
  if (!row.purchase_order_id || !row.cost_type || row.amount === null) return { error: "Orden, tipo y monto son obligatorios." };
  if (row.product_id) {
    const { count } = await supabase.from("purchase_order_lines").select("id", { count: "exact", head: true })
      .eq("purchase_order_id", row.purchase_order_id).eq("product_id", row.product_id);
    if (!count) return { error: "Ese producto no está en la orden seleccionada. Elige 'Toda la orden' u otro producto." };
  }
  // Si se cambia de orden, la orden anterior también debe recalcularse.
  const prev = id ? (await supabase.from("additional_costs").select("purchase_order_id").eq("id", id).single()).data : null;
  const { error } = id
    ? await supabase.from("additional_costs").update(row).eq("id", id)
    : await supabase.from("additional_costs").insert(row);
  if (error) return { error: friendly(error) };
  for (const po of new Set([row.purchase_order_id, prev?.purchase_order_id].filter(Boolean))) {
    await supabase.rpc("allocate_po_costs", { p_po: po });
  }
  revalidatePath("/compras");
  revalidatePath("/productos");
  revalidatePath("/inventario");
  done("/compras/costos", id ? "Costo actualizado y costo neto recalculado" : "Costo agregado y costo neto recalculado");
}

export async function deleteCost(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data } = await supabase.from("additional_costs").select("purchase_order_id").eq("id", id).single();
  const { error } = await supabase.from("additional_costs").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  if (data) await supabase.rpc("allocate_po_costs", { p_po: data.purchase_order_id });
  revalidatePath("/compras");
  revalidatePath("/productos");
  done("/compras/costos", "Costo eliminado y costo neto recalculado");
}


// ===== Envíos FBA =====
export type ShipmentItem = { id?: string; product_id: string; qty_shipped: string; qty_received: string };
export type ShipmentCost = { id?: string; cost_type: string; description: string; amount: string; charged_to: string; allocation: "units" | "value" };
export type FbaShipmentPayload = {
  id?: string;
  shipment_id: string;
  name: string;
  destination_fc: string;
  from_location: string;
  status: string;
  created_on: string;
  shipped_on: string;
  closed_on: string;
  carrier: string;
  tracking: string;
  boxes: string;
  weight_lb: string;
  notes: string;
  items: ShipmentItem[];
  costs: ShipmentCost[];
};

const MOVING = new Set(["shipped", "in_transit", "delivered", "receiving", "closed"]);

/** Movimientos de inventario que corresponden al estado actual del envío. */
function shipmentMovements(id: string, p: FbaShipmentPayload) {
  if (!MOVING.has(p.status)) return [];
  const ref = p.shipment_id ? `Envío ${p.shipment_id}` : "Envío FBA";
  const sent = p.shipped_on || p.created_on;
  const recv = p.closed_on || new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  const add = (product_id: string, movement: string, qty: number, location: string, occurred_on: string, notes?: string) =>
    qty !== 0 && rows.push({ product_id, movement, qty, location, occurred_on, reference: ref, notes: notes ?? null, fba_shipment_id: id });

  for (const it of p.items) {
    const S = Number(it.qty_shipped);
    add(it.product_id, "transfer", -S, p.from_location, sent);
    add(it.product_id, "transfer", S, "fba_inbound", sent);
    if (p.status === "receiving" || p.status === "closed") {
      const R = it.qty_received === "" ? (p.status === "closed" ? S : 0) : Number(it.qty_received);
      add(it.product_id, "transfer", -R, "fba_inbound", recv);
      add(it.product_id, "transfer", R, "amazon_fba", recv);
      if (p.status === "closed") {
        const diff = S - R;
        if (diff > 0) add(it.product_id, "damaged", -diff, "fba_inbound", recv, "Faltante en recepción FBA: reclamar a Amazon");
        if (diff < 0) add(it.product_id, "adjustment", -diff, "fba_inbound", recv, "Amazon recibió más unidades de las enviadas");
      }
    }
  }
  return rows;
}

export async function saveFbaShipment(p: FbaShipmentPayload): Promise<ActionState> {
  const items = p.items.filter((i) => i.product_id);
  if (!items.length) return { error: "Agrega al menos un producto al envío." };
  if (items.some((i) => !(Number(i.qty_shipped) > 0))) return { error: "Cada producto necesita unidades enviadas mayores a 0." };
  if (new Set(items.map((i) => i.product_id)).size !== items.length) return { error: "Hay productos repetidos en el envío." };
  if (items.some((i) => i.qty_received !== "" && Number(i.qty_received) < 0)) return { error: "Las unidades recibidas no pueden ser negativas." };
  for (const c of p.costs) if (!c.cost_type || c.amount === "" || Number.isNaN(Number(c.amount))) return { error: "Cada costo necesita tipo y monto." };
  if (["fba_inbound", "amazon_fba"].includes(p.from_location)) return { error: "El origen debe ser tu inventario, el proveedor o un prep center." };

  const supabase = await createClient();

  // Stock en el origen sin contar los movimientos que ya generó este envío
  if (MOVING.has(p.status)) {
    const q = supabase.from("inventory_movements").select("product_id, qty, fba_shipment_id")
      .eq("location", p.from_location).in("product_id", items.map((i) => i.product_id));
    const { data } = await q;
    const avail = new Map<string, number>();
    for (const m of data ?? []) if (!p.id || m.fba_shipment_id !== p.id) avail.set(m.product_id, (avail.get(m.product_id) ?? 0) + m.qty);
    const short = items.find((i) => Number(i.qty_shipped) > (avail.get(i.product_id) ?? 0));
    if (short) return { error: "Hay productos con más unidades de las disponibles en el origen. Registra primero la compra o ajusta las cantidades." };
  }

  const row = {
    shipment_id: p.shipment_id.trim().toUpperCase() || null,
    name: p.name.trim() || null,
    destination_fc: p.destination_fc.trim().toUpperCase() || null,
    from_location: p.from_location,
    status: p.status,
    created_on: p.created_on || new Date().toISOString().slice(0, 10),
    shipped_on: p.shipped_on || null,
    closed_on: p.closed_on || null,
    carrier: p.carrier || null,
    tracking: p.tracking.trim() || null,
    boxes: p.boxes === "" ? null : Number(p.boxes),
    weight_lb: p.weight_lb === "" ? null : Number(p.weight_lb),
    notes: p.notes.trim() || null,
  };
  let id = p.id;
  if (id) {
    const { error } = await supabase.from("fba_shipments").update(row).eq("id", id);
    if (error) return { error: friendly(error) };
  } else {
    const { data, error } = await supabase.from("fba_shipments").insert(row).select("id").single();
    if (error) return { error: friendly(error) };
    id = data.id as string;
  }

  // Productos y costos: borra los quitados y guarda el resto
  for (const [table, list] of [["fba_shipment_items", items], ["fba_shipment_costs", p.costs]] as const) {
    const keep = list.map((x) => x.id).filter(Boolean) as string[];
    let del = supabase.from(table).delete().eq("shipment_id", id);
    if (keep.length) del = del.not("id", "in", `(${keep.join(",")})`);
    const { error } = await del;
    if (error) return { error: friendly(error) };
  }
  for (const it of items) {
    const r = { shipment_id: id, product_id: it.product_id, qty_shipped: Number(it.qty_shipped), qty_received: it.qty_received === "" ? null : Number(it.qty_received) };
    const { error } = it.id ? await supabase.from("fba_shipment_items").update(r).eq("id", it.id) : await supabase.from("fba_shipment_items").insert(r);
    if (error) return { error: friendly(error) };
  }
  for (const c of p.costs) {
    const r = { shipment_id: id, cost_type: c.cost_type, description: c.description.trim() || null, amount: Number(c.amount), charged_to: c.charged_to, allocation: c.allocation };
    const { error } = c.id ? await supabase.from("fba_shipment_costs").update(r).eq("id", c.id) : await supabase.from("fba_shipment_costs").insert(r);
    if (error) return { error: friendly(error) };
  }

  // Rehace los movimientos de inventario según el estado del envío
  const delMoves = await supabase.from("inventory_movements").delete().eq("fba_shipment_id", id);
  if (delMoves.error) return { error: friendly(delMoves.error) };
  const moves = shipmentMovements(id, p);
  if (moves.length) {
    const { error } = await supabase.from("inventory_movements").insert(moves);
    if (error) return { error: friendly(error) };
  }

  revalidatePath("/envios");
  revalidatePath("/inventario");
  revalidatePath("/productos");
  revalidatePath("/");
  return { id };
}

export async function deleteFbaShipment(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const m = await supabase.from("inventory_movements").delete().eq("fba_shipment_id", id);
  if (m.error) return { error: friendly(m.error) };
  const { error } = await supabase.from("fba_shipments").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  revalidatePath("/envios");
  revalidatePath("/inventario");
  done("/envios", "Envío eliminado; las unidades volvieron a su origen");
}

/** Cambia el tipo de una contraparte desde la lista (proveedor, servicio, marketplace…). */
export async function setCounterpartyKind(id: string, kind: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("counterparties").update({ kind }).eq("id", id);
  if (error) return { error: friendly(error) };
  revalidatePath("/proveedores");
  revalidatePath("/compras");
  return undefined;
}

// ===== Pagos de compras =====
export async function savePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const poId = str(fd, "purchase_order_id");
  const method = str(fd, "method") ?? "bank";
  const row = {
    purchase_order_id: poId,
    paid_on: str(fd, "paid_on"),
    amount: num(fd, "amount"),
    method,
    paid_by_id: method === "third_party" ? str(fd, "paid_by_id") : null,
    bank_transaction_id: method === "bank" || method === "card" ? str(fd, "bank_transaction_id") : null,
    notes: str(fd, "notes"),
  };
  if (!poId || !row.paid_on || !row.amount || row.amount <= 0) return { error: "Fecha y monto (mayor a 0) son obligatorios." };
  if (method === "third_party" && !row.paid_by_id) return { error: "Indica qué tercero hizo el pago." };
  const { error } = await supabase.from("po_payments").insert(row);
  if (error) return { error: friendly(error) };
  // El movimiento del banco queda vinculado a la compra
  if (row.bank_transaction_id) await supabase.from("bank_transactions").update({ purchase_order_id: poId }).eq("id", row.bank_transaction_id);
  revalidatePath(`/compras/${poId}`);
  revalidatePath("/compras");
  revalidatePath("/proveedores");
  return { id: "ok" };
}

export async function deletePayment(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data } = await supabase.from("po_payments").select("purchase_order_id, bank_transaction_id").eq("id", id).single();
  const { error } = await supabase.from("po_payments").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  if (data?.bank_transaction_id) await supabase.from("bank_transactions").update({ purchase_order_id: null }).eq("id", data.bank_transaction_id);
  if (data) revalidatePath(`/compras/${data.purchase_order_id}`);
  revalidatePath("/compras");
  return undefined;
}

// ===== Cuenta con terceros (dinero nuestro que cobran o manejan) =====
export async function saveAgentEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const cp = str(fd, "counterparty_id");
  const kind = str(fd, "kind") ?? "liquidation";
  const amount = num(fd, "amount");
  if (!cp || !amount || !str(fd, "entry_date")) return { error: "Fecha y monto son obligatorios." };
  const { error } = await supabase.from("agent_entries").insert({
    counterparty_id: cp, entry_date: str(fd, "entry_date"), kind,
    amount: kind === "fee" ? -Math.abs(amount) : amount, description: str(fd, "description"),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/proveedores/${cp}`);
  revalidatePath("/");
  return { id: "ok" };
}

export async function deleteAgentEntry(id: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data } = await supabase.from("agent_entries").select("counterparty_id").eq("id", id).single();
  const { error } = await supabase.from("agent_entries").delete().eq("id", id);
  if (error) return { error: friendly(error) };
  if (data) revalidatePath(`/proveedores/${data.counterparty_id}`);
  return undefined;
}
