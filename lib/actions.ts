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
export type POLine = { id?: string; product_id: string; cases: string; units: string; unit_cost: string };
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
    const { data: existingCosts } = await supabase.from("additional_costs").select("id").eq("purchase_order_id", p.id);
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
  const sign = fd.get("direction") === "out" ? -1 : 1;
  const row = {
    bank_account_id: str(fd, "bank_account_id"),
    txn_date: str(fd, "txn_date"),
    description: str(fd, "description"),
    amount: sign * amount,
    category: str(fd, "category"),
    counterparty_id: str(fd, "counterparty_id"),
    partner_id: str(fd, "partner_id"),
    purchase_order_id: str(fd, "purchase_order_id"),
    notes: str(fd, "notes"),
  };
  if (!row.txn_date || !row.description || !row.bank_account_id) return { error: "Fecha, cuenta y descripción son obligatorias." };
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
  const { error } = await supabase.from("inventory_movements").delete().eq("id", id).neq("movement", "purchase");
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
  entries: { product_id: string; location: string; diff: number }[];
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
    reference: "Conteo de inventario",
    notes: p.notes || null,
  }));
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { error: friendly(error) };

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

// ===== Envíos a Amazon (traslado de varias unidades desde mi inventario a FBA) =====
export type ShipmentPayload = {
  shipment_id: string;
  date: string;
  from_location: string;
  to_location: string;
  notes: string;
  lines: { product_id: string; qty: number }[];
};

export async function createShipment(p: ShipmentPayload): Promise<ActionState> {
  const lines = p.lines.filter((l) => l.qty > 0);
  if (!lines.length) return { error: "Indica cuántas unidades envías de al menos un producto." };
  if (!p.date) return { error: "La fecha es obligatoria." };
  if (p.from_location === p.to_location) return { error: "El origen y el destino deben ser distintos." };

  const supabase = await createClient();
  // Valida que haya stock suficiente en el origen
  const { data: stock } = await supabase.from("inventory_movements").select("product_id, qty")
    .eq("location", p.from_location).in("product_id", lines.map((l) => l.product_id));
  const available = new Map<string, number>();
  for (const m of stock ?? []) available.set(m.product_id, (available.get(m.product_id) ?? 0) + m.qty);
  const short = lines.find((l) => l.qty > (available.get(l.product_id) ?? 0));
  if (short) return { error: "Hay productos con más unidades de las disponibles en el origen. Revisa las cantidades." };

  const reference = p.shipment_id ? `Envío ${p.shipment_id}` : "Envío a Amazon";
  const rows = lines.flatMap((l) => [
    { product_id: l.product_id, movement: "transfer", qty: -l.qty, location: p.from_location, occurred_on: p.date, reference, notes: p.notes || null },
    { product_id: l.product_id, movement: "transfer", qty: l.qty, location: p.to_location, occurred_on: p.date, reference, notes: p.notes || null },
  ]);
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) return { error: friendly(error) };
  revalidatePath("/inventario");
  revalidatePath("/productos");
  const total = lines.reduce((a, l) => a + l.qty, 0);
  done("/inventario", `${reference} registrado: ${total} unidades de ${lines.length} producto${lines.length === 1 ? "" : "s"}`);
}
