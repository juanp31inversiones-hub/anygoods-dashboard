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
  amazon_fba: "Amazon FBA",
};

/** Ubicaciones en orden de flujo: llega la compra → se envía a Amazon. */
export const LOCATIONS = Object.keys(LOCATION_LABELS);

export const KIND_LABELS: Record<string, string> = {
  supplier: "Proveedor",
  brand: "Marca",
  marketplace: "Marketplace",
  service: "Servicio",
  partner: "Socio",
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

export const DOC_TYPE_LABELS: Record<string, string> = {
  our_po: "Mi PO (orden enviada al proveedor)",
  supplier_invoice: "Invoice del proveedor",
  payment_proof: "Comprobante de pago",
  other: "Otro documento",
};
