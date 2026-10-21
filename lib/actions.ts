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
export type POPayload = {
  id?: string;
  supplier_id: string;
  paid_via_id: string;
  po_number: string;
  invoice_number: string;
  purchase_date: string;
  arrival_date: string;
  status: string;
  supplier_shipping: string;
  amazon_shipping: string;
  amazon_placement_fee: string;
  prep_cost: string;
  notes: string;
  location: string;
  lines: POLine[];
};

export async function savePurchaseOrder(p: POPayload): Promise<ActionState> {
  if (!p.supplier_id) return { error: "Selecciona el proveedor." };
  if (!p.purchase_date) return { error: "La fecha de compra es obligatoria." };
  if (!p.lines.length) return { error: "Agrega al menos un producto." };
  for (const l of p.lines) {
    if (!l.product_id || !(Number(l.units) > 0) || l.unit_cost === "" || Number(l.unit_cost) < 0)
      return { error: "Cada línea necesita producto, unidades mayores a 0 y costo unitario." };
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
