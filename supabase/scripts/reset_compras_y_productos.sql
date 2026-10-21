-- Reinicia compras, envíos FBA e inventario para empezar desde 0.
-- Conserva: los 3 productos actuales, proveedores, socios, usuarios y movimientos bancarios.
begin;
update bank_transactions set purchase_order_id = null where purchase_order_id is not null;
delete from inventory_movements;
delete from fba_shipment_costs;
delete from fba_shipment_items;
delete from fba_shipments;
delete from additional_costs;
delete from purchase_order_lines;
delete from purchase_orders;
delete from products where description not in (
  'CHERIE SWEET 16oz Organic Matcha Powder',
  'CLEANING HEROES 99% Isopropyl Alcohol Spray 32oz',
  'CLEANING HEROES Oven & Grill 32oz');
commit;

select (select count(*) from products) productos, (select count(*) from purchase_orders) compras,
  (select count(*) from inventory_movements) movimientos, (select count(*) from bank_transactions) movimientos_banco;
