const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const num = new Intl.NumberFormat("en-US");

export const money = (v: number | string | null | undefined) => usd.format(Number(v ?? 0));
export const units = (v: number | string | null | undefined) => num.format(Number(v ?? 0));
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const date = (v: string | null) =>
  v ? new Date(v + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const CATEGORY_LABELS: Record<string, string> = {
  capital_contribution: "Aporte socio",
  capital_return: "Devolución a socio",
  amazon_payout: "Pago Amazon",
  other_sales: "Otras ventas",
  inventory: "Inventario",
  shipping: "Envíos",
  software: "Herramientas",
  legal: "Legal",
  fees: "Cargos Amazon/eBay",
  service_fee: "Fee de servicio",
  other_expense: "Otro gasto",
  transfer: "Transferencia",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  ordered: "Pedida",
  received: "Recibida",
  sent_to_amazon: "Enviada a Amazon",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

export const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "Compra",
  sale: "Venta",
  customer_return: "Devolución de cliente",
  removal: "Retiro de Amazon",
  liquidation: "Liquidación",
  damaged: "Dañado / perdido",
  reimbursed: "Reembolsado por Amazon",
  adjustment: "Ajuste",
  transfer: "Traslado",
};

export const LOCATION_LABELS: Record<string, string> = {
  own_warehouse: "Mi inventario",
  supplier_warehouse: "Almacén del proveedor",
  prep_center: "Prep center",
  fba_inbound: "En camino a Amazon",
  amazon_fba: "Amazon FBA",
};

/** Dónde puede llegar una compra. A Amazon se llega solo con un envío FBA. */
export const ARRIVAL_LOCATIONS = ["own_warehouse", "supplier_warehouse", "prep_center"];

/** Ubicaciones en orden de flujo: llega la compra → se envía a Amazon. */
export const LOCATIONS = Object.keys(LOCATION_LABELS);

export const KIND_LABELS: Record<string, string> = {
  supplier: "Proveedor",
  brand: "Marca",
  marketplace: "Marketplace",
  service: "Servicio",
  partner: "Socio",
  customer: "Cliente",
  other: "Otro",
};

export const COST_TYPE_LABELS: Record<string, string> = {
  supplier_shipping: "Transporte del proveedor",
  amazon_inbound: "Envío a Amazon",
  placement_fee: "Inbound placement fee",
  prep: "Prep y etiquetado",
  duties: "Aranceles / aduana",
  inspection: "Inspección",
  storage: "Almacenamiento previo",
  supplier_discount: "Descuento / nota crédito",
  other: "Otro costo",
};

/** Orden fijo de columnas para los desgloses. */
export const COST_TYPES = Object.keys(COST_TYPE_LABELS);

/** Costos que sí pertenecen a una compra. Los de Amazon (envío y placement) van en el envío FBA. */
export const PO_COST_TYPES = COST_TYPES.filter((t) => t !== "amazon_inbound" && t !== "placement_fee");
export const PO_COST_TYPE_LABELS: Record<string, string> = Object.fromEntries(PO_COST_TYPES.map((t) => [t, COST_TYPE_LABELS[t]]));

/** Contrapartes que pueden ser proveedor de una compra. */
export const SUPPLIER_KINDS = ["supplier", "brand"];

export const DOC_TYPE_LABELS: Record<string, string> = {
  our_po: "Mi PO (orden enviada al proveedor)",
  supplier_invoice: "Invoice del proveedor",
  payment_proof: "Comprobante de pago",
  other: "Otro documento",
};

// ===== Envíos FBA =====
export const SHIPMENT_STATUS: { key: string; label: string; hint: string }[] = [
  { key: "working", label: "Borrador", hint: "Plan creado en Send to Amazon; aún no sale" },
  { key: "shipped", label: "Enviado", hint: "Entregado a la transportadora" },
  { key: "in_transit", label: "En tránsito", hint: "Viajando al centro de Amazon" },
  { key: "delivered", label: "Entregado", hint: "Llegó al centro de Amazon" },
  { key: "receiving", label: "Recibiendo", hint: "Checked-in: Amazon está contando unidades" },
  { key: "closed", label: "Cerrado", hint: "Recepción terminada" },
  { key: "cancelled", label: "Cancelado", hint: "No se envió" },
];
export const SHIPMENT_STATUS_LABELS: Record<string, string> = Object.fromEntries(SHIPMENT_STATUS.map((s) => [s.key, s.label]));
/** Estados en los que las unidades ya salieron de tu inventario. */
export const SHIPMENT_MOVING = ["shipped", "in_transit", "delivered", "receiving", "closed"];

export const FBA_COST_TYPE_LABELS: Record<string, string> = {
  inbound_shipping: "Transporte a Amazon",
  placement_fee: "Inbound placement fee",
  amazon_prep: "Prep / etiquetado por Amazon",
  manual_processing: "Manual processing fee",
  other: "Otro costo",
};

export const CHARGED_TO_LABELS: Record<string, string> = {
  amazon_balance: "Descontado del saldo de Amazon",
  bank: "Pagado desde el banco",
  card: "Pagado con tarjeta",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank: "Banco (transferencia)",
  card: "Tarjeta",
  third_party: "Pagado por un tercero",
  credit_note: "Nota crédito / saldo a favor",
  other: "Otro",
};

export const AGENT_ENTRY_LABELS: Record<string, string> = {
  liquidation: "Liquidación cobrada a nuestro favor",
  other_income: "Otro dinero cobrado a nuestro favor",
  fee: "Cobro / comisión del tercero",
  adjustment: "Ajuste",
};
