-- Costo neto del producto = costo proveedor + costos adicionales (desglosados).
-- Cada costo adicional se asigna a una orden de compra (toda la orden o un producto)
-- y se reparte entre sus líneas por unidades o por valor.

create table if not exists additional_costs (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid references products(id),               -- null = toda la orden
  cost_type text not null check (cost_type in (
    'supplier_shipping', 'amazon_inbound', 'placement_fee', 'prep', 'duties',
    'inspection', 'storage', 'supplier_discount', 'other')),
  description text,
  amount numeric(12,2) not null,                          -- negativo para descuentos
  allocation text not null default 'units' check (allocation in ('units', 'value')),
  cost_date date,
  counterparty_id uuid references counterparties(id),     -- a quién se pagó
  bank_transaction_id uuid references bank_transactions(id),
  created_at timestamptz default now()
);
create index if not exists additional_costs_po_idx on additional_costs(purchase_order_id);
create index if not exists additional_costs_product_idx on additional_costs(product_id);
create index if not exists additional_costs_cp_idx on additional_costs(counterparty_id);
create index if not exists additional_costs_txn_idx on additional_costs(bank_transaction_id);
alter table additional_costs enable row level security;
create policy partners_all on additional_costs for all to authenticated
  using ((select is_partner())) with check ((select is_partner()));

-- Reparto de cada costo entre las líneas de su orden.
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
)
select line_id, cost_type, sum(amount) amount from alloc group by line_id, cost_type;

-- Recalcula costos asignados y costo neto por unidad de cada línea de la orden.
create or replace function allocate_po_costs(p_po uuid) returns void
language plpgsql set search_path = public as $$
begin
  update purchase_order_lines l set
    allocated_costs = coalesce((select sum(c.amount) from v_line_costs c where c.line_id = l.id), 0),
    landed_unit_cost = l.unit_cost + coalesce((select sum(c.amount) from v_line_costs c where c.line_id = l.id), 0) / nullif(l.units, 0)
  where l.purchase_order_id = p_po;
end $$;

-- Saldo con terceros usando el transporte del proveedor desde costos adicionales.
create or replace view v_agent_balance with (security_invoker = on) as
select c.name agent,
  coalesce((select -sum(t.amount) from bank_transactions t where t.counterparty_id=c.id and t.category='inventory'),0) deposited,
  coalesce((select sum(l.units*l.unit_cost) from purchase_orders po join purchase_order_lines l on l.purchase_order_id=po.id where po.paid_via_id=c.id),0)
  + coalesce((select sum(ac.amount) from additional_costs ac join purchase_orders po on po.id=ac.purchase_order_id
              where po.paid_via_id=c.id and ac.cost_type='supplier_shipping'),0) spent_on_purchases
from counterparties c
where exists (select 1 from purchase_orders po where po.paid_via_id = c.id);

-- Historial: desglose exacto por línea desde el Excel (supplier transport, Amazon transport, placement).
insert into additional_costs (purchase_order_id, product_id, cost_type, description, amount, allocation, cost_date)
select po.id, p.id, v.t, 'Histórico (Excel Purchases)', v.amt, 'units', po.purchase_date
from (values
('5409','OLD SPICE Body Wash Fiji 16oz 4-Pack','amazon_inbound',50.0),
('5409','OLD SPICE Body Wash Fiji 16oz 4-Pack','placement_fee',120.0),
('30163','EQUAL Packets 50ct','supplier_shipping',5.45),
('30163','EQUAL Packets 50ct','amazon_inbound',36.2),
('30163','DOVE Clinical Pro+Care Cool Essential 1.7oz','supplier_shipping',54.55),
('30320','LA LOOKS Styling Gel Mega Shaper Hold Lv9 20oz','supplier_shipping',13.27),
('30320','LA LOOKS Styling Gel Mega Shaper Hold Lv9 20oz','amazon_inbound',43.61),
('30320','ECOCO Olive Oil Styling Gel Green 80oz','supplier_shipping',9.03),
('30320','ECOCO Olive Oil Styling Gel Green 80oz','amazon_inbound',29.65),
('30320','ECOCO Black Castor & Flax Seed Oil Gel 32oz','supplier_shipping',1.06),
('30320','ECOCO Black Castor & Flax Seed Oil Gel 32oz','amazon_inbound',3.49),
('30320','ECOCO Coconut Styling Gel 32oz','supplier_shipping',6.37),
('30320','ECOCO Coconut Styling Gel 32oz','amazon_inbound',20.93),
('30320','BIGEN Permanent Powder Hair Color #59 Oriental Black','supplier_shipping',12.74),
('30320','ARM & HAMMER SpinBrush Pro Extra Soft 1ct','supplier_shipping',10.62),
('30320','ARM & HAMMER SpinBrush Pro Extra Soft 1ct','amazon_inbound',34.88),
('30320','JUST FOR ME Relaxer No Lye Conditioning Creme','supplier_shipping',1.59),
('30320','EQUAL Packets 50ct','supplier_shipping',5.31),
('30320','EQUAL Packets 50ct','amazon_inbound',17.44),
('30630','ECOCO Curl & Wave Styling Gel Pink 32oz','supplier_shipping',53.43),
('30630','ECOCO Curl & Wave Styling Gel Pink 32oz','amazon_inbound',106.75),
('30630','ECOCO Curl & Wave Styling Gel Pink 32oz','placement_fee',0.15),
('30630','NUGGET Shoe Polish 2oz Black','supplier_shipping',2.63),
('30630','NUGGET Shoe Polish 2oz Black','amazon_inbound',18.44),
('30630','NUGGET Shoe Polish 2oz Black','placement_fee',0.51),
('30630','ECOCO Olive Oil Styling Gel Green 32oz','supplier_shipping',3.94),
('30630','ECOCO Olive Oil Styling Gel Green 32oz','amazon_inbound',12.13),
('30630','ECOCO Olive Oil Styling Gel Green 32oz','placement_fee',0.22),
('42486','ELASTA QP Glaze Mango Butter 6oz','supplier_shipping',7.02),
('42486','HI & DRY Roll On Powder Fresh Pink 1.7oz','supplier_shipping',16.39),
('42486','ECOCO Sport Styling Gel Blue 16oz','supplier_shipping',7.32),
('42486','ECOCO Olive Oil Styling Gel Green 32oz','supplier_shipping',2.93),
('42486','NUGGET Shoe Polish 2oz Black','supplier_shipping',4.68),
('42486','ECOCO Curl & Wave Styling Gel Pink 32oz','supplier_shipping',14.63),
('42486','BASIS Soap 4oz Sensitive Skin Bar','supplier_shipping',7.02),
('18046-1','CHERIE SWEET 16oz Organic Matcha Powder','amazon_inbound',83.11),
('18055','CHERIE SWEET 16oz Organic Matcha Powder','amazon_inbound',16.01),
('18055','CHERIE SWEET 16oz Organic Matcha Powder','placement_fee',15.84),
('18068','CHERIE SWEET 16oz Organic Matcha Powder','amazon_inbound',19.86),
('18068','CHERIE SWEET 16oz Organic Matcha Powder','placement_fee',13.68),
('2801','CLEANING HEROES 99% Isopropyl Alcohol Spray 32oz','amazon_inbound',174.4),
('2801','CLEANING HEROES 99% Isopropyl Alcohol Spray 32oz','placement_fee',71.28),
('18072','CHERIE SWEET 16oz Organic Matcha Powder','amazon_inbound',41.74),
('18072','CHERIE SWEET 16oz Organic Matcha Powder','placement_fee',14.04)
) v(inv, descr, t, amt)
join purchase_orders po on po.invoice_number = v.inv
join products p on p.description = v.descr;

select allocate_po_costs(id) from purchase_orders;

-- save_purchase_order: ahora recibe p.costs y deja de usar los campos fijos de logística (legado).
create or replace function public.save_purchase_order(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_loc text := coalesce(nullif(p->>'location', ''), 'amazon_fba');
  v_date date;
  l jsonb;
  c jsonb;
  v_line uuid;
begin
  if v_id is null then
    insert into purchase_orders (supplier_id, purchase_date) values ((p->>'supplier_id')::uuid, (p->>'purchase_date')::date)
    returning id into v_id;
  end if;

  update purchase_orders set
    supplier_id = (p->>'supplier_id')::uuid,
    paid_via_id = nullif(p->>'paid_via_id', '')::uuid,
    po_number = nullif(p->>'po_number', ''),
    invoice_number = nullif(p->>'invoice_number', ''),
    purchase_date = (p->>'purchase_date')::date,
    arrival_date = nullif(p->>'arrival_date', '')::date,
    status = coalesce(nullif(p->>'status', ''), 'ordered')::po_status,
    notes = nullif(p->>'notes', '')
  where id = v_id
  returning coalesce(arrival_date, purchase_date) into v_date;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_line := nullif(l->>'id', '')::uuid;
    if v_line is null then
      insert into purchase_order_lines (purchase_order_id, product_id, cases, units, unit_cost)
      values (v_id, (l->>'product_id')::uuid, nullif(l->>'cases', '')::numeric, (l->>'units')::int, (l->>'unit_cost')::numeric)
      returning id into v_line;
      insert into inventory_movements (product_id, po_line_id, movement, qty, occurred_on, location, reference)
      values ((l->>'product_id')::uuid, v_line, 'purchase', (l->>'units')::int, v_date, v_loc,
              'PO ' || coalesce(nullif(p->>'invoice_number', ''), v_id::text));
    else
      update purchase_order_lines set product_id = (l->>'product_id')::uuid, cases = nullif(l->>'cases', '')::numeric,
        units = (l->>'units')::int, unit_cost = (l->>'unit_cost')::numeric
      where id = v_line and purchase_order_id = v_id;
      update inventory_movements set product_id = (l->>'product_id')::uuid, qty = (l->>'units')::int, occurred_on = v_date
      where po_line_id = v_line and movement = 'purchase';
    end if;
  end loop;

  -- Costos adicionales (los quitados del formulario los borra la app antes)
  for c in select * from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) loop
    if nullif(c->>'id', '') is null then
      insert into additional_costs (purchase_order_id, product_id, cost_type, description, amount, allocation, cost_date, counterparty_id)
      values (v_id, nullif(c->>'product_id', '')::uuid, c->>'cost_type', nullif(c->>'description', ''), (c->>'amount')::numeric,
              coalesce(nullif(c->>'allocation', ''), 'units'), coalesce(nullif(c->>'cost_date', '')::date, v_date),
              nullif(c->>'counterparty_id', '')::uuid);
    else
      update additional_costs set product_id = nullif(c->>'product_id', '')::uuid, cost_type = c->>'cost_type',
        description = nullif(c->>'description', ''), amount = (c->>'amount')::numeric,
        allocation = coalesce(nullif(c->>'allocation', ''), 'units'), cost_date = nullif(c->>'cost_date', '')::date,
        counterparty_id = nullif(c->>'counterparty_id', '')::uuid
      where id = (c->>'id')::uuid and purchase_order_id = v_id;
    end if;
  end loop;

  perform allocate_po_costs(v_id);
  return v_id;
end $$;
