-- Reinicia compras e inventario para empezar desde 0 (oct-2026).
-- Conserva: los 3 productos actuales, proveedores, socios, usuarios y movimientos bancarios.
-- Borra: todas las órdenes de compra, sus líneas y costos adicionales, todos los movimientos
-- de inventario y los demás productos. Los pagos del banco quedan desvinculados de las compras.
begin;
update bank_transactions set purchase_order_id = null where purchase_order_id is not null;
update additional_costs set bank_transaction_id = null where bank_transaction_id is not null;
delete from additional_costs;
delete from inventory_movements;
delete from purchase_order_lines;
delete from purchase_orders;
delete from products where description not in (
  'CHERIE SWEET 16oz Organic Matcha Powder',
  'CLEANING HEROES 99% Isopropyl Alcohol Spray 32oz',
  'CLEANING HEROES Oven & Grill 32oz');
commit;

select (select count(*) from products) productos, (select count(*) from purchase_orders) compras,
  (select count(*) from inventory_movements) movimientos, (select count(*) from bank_transactions) movimientos_banco;
