-- Clientes (ventas mayoristas fuera de Amazon, ej. AV Global).
alter type counterparty_kind add value if not exists 'customer';

-- Datos aplicados (oct-2026):
-- * Mercury 16-ene-2026 +$962.43 ("Amazon Inventory Loss") era una venta mayorista a AV Global → other_sales.
-- * Salidas de Basis, Elasta, Hi & Dry y Nugget pasan de "Ventas Amazon no registradas" a "Venta mayorista AV Global" con precio.
