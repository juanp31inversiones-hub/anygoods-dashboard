-- Ubicación del inventario (FBA vs almacén del proveedor), compras pagadas por terceros
-- y categoría para fees de servicios (ej. initiation fee de EC Access).

alter type txn_category add value if not exists 'service_fee';
alter type inventory_move add value if not exists 'transfer';

-- 'amazon_fba' | 'supplier_warehouse' | 'own_warehouse'
alter table inventory_movements add column location text not null default 'amazon_fba';

-- Compra pagada por un tercero con fondos nuestros (EC Access manejó el capital en 2025)
alter table purchase_orders add column paid_via_id uuid references counterparties(id);
create index on purchase_orders(paid_via_id);

create or replace view v_inventory_on_hand with (security_invoker = on) as
select p.id product_id, p.description, p.upc, p.asin,
  coalesce(sum(m.qty),0) units_on_hand,
  coalesce(sum(m.qty * l.landed_unit_cost),0) inventory_value,
  p.retail_price,
  coalesce(sum(m.qty) filter (where m.location='amazon_fba'),0) units_fba,
  coalesce(sum(m.qty) filter (where m.location<>'amazon_fba'),0) units_other
from products p
left join inventory_movements m on m.product_id = p.id
left join purchase_order_lines l on l.id = m.po_line_id
group by p.id;

-- Saldo de capital entregado a un tercero vs compras que hizo con él
create or replace view v_agent_balance with (security_invoker = on) as
select c.name agent,
  coalesce((select -sum(t.amount) from bank_transactions t where t.counterparty_id=c.id and t.category='inventory'),0) deposited,
  coalesce((select sum(l.units*l.unit_cost) from purchase_orders po join purchase_order_lines l on l.purchase_order_id=po.id where po.paid_via_id=c.id),0)
  + coalesce((select sum(po.supplier_shipping) from purchase_orders po where po.paid_via_id=c.id),0) spent_on_purchases
from counterparties c
where exists (select 1 from purchase_orders po where po.paid_via_id = c.id);
