-- Marca qué pedidos ya se descontaron del inventario (las ventas se descuentan por pedido despachado, no por pago).
alter table amazon_orders add column if not exists inventory_counted boolean not null default false;
-- Línea base: el inventario de la app ya cuadra con Amazon (22-oct-2026), así que lo despachado hasta hoy ya está contado.
update amazon_orders set inventory_counted = true where status in ('Shipped', 'Canceled');
-- Datos: Alcohol = 198 enviadas − 89 despachadas = 109 (igual que Amazon). Los "16 faltantes" eran ventas con pago diferido.
