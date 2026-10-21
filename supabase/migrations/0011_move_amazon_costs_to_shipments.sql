-- Las compras no llevan costos de Amazon: el transporte a Amazon y el placement fee pertenecen al envío FBA.
-- Se trasladan los costos existentes a envíos FBA (cerrados) y se marcan en la compra como trasladados.
alter table additional_costs add column if not exists moved_to_shipment_id uuid references fba_shipments(id);
create index if not exists additional_costs_moved_idx on additional_costs(moved_to_shipment_id);

create or replace view v_line_costs with (security_invoker = on) as
with lines as (
  select id line_id, purchase_order_id, product_id, units, units * unit_cost line_value
  from purchase_order_lines
), alloc as (
  select c.id cost_id, c.cost_type, li.line_id,
    c.amount * case when c.allocation = 'value'
      then li.line_value / nullif(sum(li.line_value) over (partition by c.id), 0)
      else li.units::numeric / nullif(sum(li.units) over (partition by c.id), 0) end amount
  from additional_costs c
  join lines li on li.purchase_order_id = c.purchase_order_id
   and (c.product_id is null or c.product_id = li.product_id)
  where c.moved_to_shipment_id is null
)
select line_id, cost_type, sum(amount) amount from alloc group by line_id, cost_type;

do $$
declare r record; v_ship uuid; v_date date;
begin
  for r in
    select po.id po_id, po.po_number, po.invoice_number, po.purchase_date, po.arrival_date, l.product_id, l.units, l.id line_id
    from purchase_orders po join purchase_order_lines l on l.purchase_order_id = po.id
    where exists (select 1 from additional_costs ac where ac.purchase_order_id = po.id
                  and ac.cost_type in ('amazon_inbound','placement_fee') and ac.moved_to_shipment_id is null)
  loop
    v_date := coalesce(r.arrival_date, r.purchase_date);
    insert into fba_shipments (name, from_location, status, created_on, shipped_on, closed_on, carrier, notes)
    values ('Envío ' || coalesce(r.po_number, r.invoice_number), 'own_warehouse', 'closed', r.purchase_date, v_date, v_date,
            'amazon_partnered', 'Migrado desde la compra ' || coalesce(r.po_number, '') || ' / factura ' || coalesce(r.invoice_number, '') || '. Completa el Shipment ID y el centro de Amazon.')
    returning id into v_ship;
    insert into fba_shipment_items (shipment_id, product_id, qty_shipped, qty_received) values (v_ship, r.product_id, r.units, r.units);
    insert into fba_shipment_costs (shipment_id, cost_type, description, amount, charged_to, allocation)
    select v_ship, case ac.cost_type when 'amazon_inbound' then 'inbound_shipping' else 'placement_fee' end,
           coalesce(ac.description, 'Trasladado desde la compra'), ac.amount, 'amazon_balance', 'units'
    from additional_costs ac where ac.purchase_order_id = r.po_id and ac.cost_type in ('amazon_inbound','placement_fee') and ac.moved_to_shipment_id is null;
    update additional_costs set moved_to_shipment_id = v_ship
    where purchase_order_id = r.po_id and cost_type in ('amazon_inbound','placement_fee') and moved_to_shipment_id is null;
    update inventory_movements set location = 'own_warehouse' where po_line_id = r.line_id and movement = 'purchase';
    insert into inventory_movements (product_id, movement, qty, location, occurred_on, reference, fba_shipment_id)
    values (r.product_id, 'transfer', -r.units, 'own_warehouse', v_date, 'Envío ' || coalesce(r.po_number, r.invoice_number), v_ship),
           (r.product_id, 'transfer',  r.units, 'fba_inbound',   v_date, 'Envío ' || coalesce(r.po_number, r.invoice_number), v_ship),
           (r.product_id, 'transfer', -r.units, 'fba_inbound',   v_date, 'Envío ' || coalesce(r.po_number, r.invoice_number), v_ship),
           (r.product_id, 'transfer',  r.units, 'amazon_fba',    v_date, 'Envío ' || coalesce(r.po_number, r.invoice_number), v_ship);
    perform allocate_po_costs(r.po_id);
  end loop;
end $$;
