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
