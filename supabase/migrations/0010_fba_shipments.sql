-- Envíos a Amazon FBA (Send to Amazon).
-- Ciclo: working → shipped → in_transit → delivered → receiving → closed (o cancelled).
-- Mientras el envío viaja, las unidades quedan en la ubicación 'fba_inbound' (en camino a Amazon).
-- Al cerrar, lo recibido pasa a 'amazon_fba' y el faltante queda registrado como pérdida a reclamar.

create table if not exists fba_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_id text,                       -- FBA15XXXXXXX (Seller Central)
  name text,                              -- nombre del plan / envío
  destination_fc text,                    -- centro de distribución (ORF2, MCC1…)
  from_location text not null default 'own_warehouse',
  status text not null default 'working' check (status in
    ('working', 'shipped', 'in_transit', 'delivered', 'receiving', 'closed', 'cancelled')),
  created_on date not null default current_date,
  shipped_on date,
  closed_on date,
  carrier text,                           -- 'amazon_partnered' | 'own' | nombre de la transportadora
  tracking text,
  boxes int,
  weight_lb numeric(10,2),
  notes text,
  created_at timestamptz default now()
);
create unique index if not exists fba_shipments_shipment_id_key on fba_shipments(shipment_id) where shipment_id is not null;

create table if not exists fba_shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references fba_shipments(id) on delete cascade,
  product_id uuid not null references products(id),
  qty_shipped int not null check (qty_shipped > 0),
  qty_received int check (qty_received >= 0),
  unique (shipment_id, product_id)
);
create index if not exists fba_shipment_items_product_idx on fba_shipment_items(product_id);

create table if not exists fba_shipment_costs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references fba_shipments(id) on delete cascade,
  cost_type text not null check (cost_type in
    ('inbound_shipping', 'placement_fee', 'amazon_prep', 'manual_processing', 'other')),
  description text,
  amount numeric(12,2) not null,
  charged_to text not null default 'amazon_balance' check (charged_to in ('amazon_balance', 'bank', 'card')),
  allocation text not null default 'units' check (allocation in ('units', 'value')),
  bank_transaction_id uuid references bank_transactions(id),
  created_at timestamptz default now()
);
create index if not exists fba_shipment_costs_shipment_idx on fba_shipment_costs(shipment_id);
create index if not exists fba_shipment_costs_txn_idx on fba_shipment_costs(bank_transaction_id);

alter table inventory_movements add column if not exists fba_shipment_id uuid references fba_shipments(id);
create index if not exists inventory_movements_fba_shipment_idx on inventory_movements(fba_shipment_id);

alter table fba_shipments enable row level security;
alter table fba_shipment_items enable row level security;
alter table fba_shipment_costs enable row level security;
create policy partners_all on fba_shipments for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on fba_shipment_items for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on fba_shipment_costs for all to authenticated using ((select is_partner())) with check ((select is_partner()));

-- Costo de compra promedio por producto (proveedor + costos adicionales de la orden)
create or replace view v_product_po_cost with (security_invoker = on) as
select product_id, sum(units * landed_unit_cost) / nullif(sum(units), 0) po_unit_cost
from purchase_order_lines where landed_unit_cost is not null group by product_id;

-- Reparto de los costos de cada envío entre sus productos (por unidades enviadas o por valor a costo)
create or replace view v_shipment_item_costs with (security_invoker = on) as
with items as (
  select i.id item_id, i.shipment_id, i.product_id, i.qty_shipped,
    i.qty_shipped * coalesce(pc.po_unit_cost, 0) item_value
  from fba_shipment_items i left join v_product_po_cost pc on pc.product_id = i.product_id
)
select it.item_id, it.shipment_id, it.product_id, it.qty_shipped, c.cost_type,
  c.amount * case when c.allocation = 'value'
    then it.item_value / nullif(sum(it.item_value) over (partition by c.id), 0)
    else it.qty_shipped::numeric / nullif(sum(it.qty_shipped) over (partition by c.id), 0) end amount
from fba_shipment_costs c join items it on it.shipment_id = c.shipment_id;

-- Costo de envío a FBA por unidad, promedio por producto (envíos no cancelados)
create or replace view v_product_inbound_cost with (security_invoker = on) as
with costs as (
  select ic.product_id, sum(ic.amount) cost
  from v_shipment_item_costs ic join fba_shipments s on s.id = ic.shipment_id
  where s.status <> 'cancelled' group by ic.product_id
), shipped as (
  select i.product_id, sum(i.qty_shipped) units
  from fba_shipment_items i join fba_shipments s on s.id = i.shipment_id
  where s.status <> 'cancelled' group by i.product_id
)
select s.product_id, coalesce(c.cost, 0) / nullif(s.units, 0) inbound_unit_cost
from shipped s left join costs c on c.product_id = s.product_id;

-- Inventario valorizado: fuera de Amazon a costo de compra; en Amazon o en camino, + costo de envío FBA.
create or replace view v_inventory_on_hand with (security_invoker = on) as
with qty as (
  select product_id,
    sum(qty) units_on_hand,
    sum(qty) filter (where location = 'amazon_fba') units_fba,
    sum(qty) filter (where location <> 'amazon_fba') units_other,
    sum(qty) filter (where location in ('amazon_fba', 'fba_inbound')) units_amazon_side
  from inventory_movements group by product_id
)
select p.id product_id, p.description, p.upc, p.asin,
  coalesce(q.units_on_hand, 0) units_on_hand,
  coalesce(q.units_on_hand, 0) * coalesce(c.po_unit_cost, 0)
    + coalesce(q.units_amazon_side, 0) * coalesce(ib.inbound_unit_cost, 0) inventory_value,
  p.retail_price,
  coalesce(q.units_fba, 0) units_fba,
  coalesce(q.units_other, 0) units_other,
  p.image_url,
  c.po_unit_cost avg_cost,
  p.active,
  ib.inbound_unit_cost,
  coalesce(c.po_unit_cost, 0) + coalesce(ib.inbound_unit_cost, 0) fba_unit_cost
from products p
left join qty q on q.product_id = p.id
left join v_product_po_cost c on c.product_id = p.id
left join v_product_inbound_cost ib on ib.product_id = p.id;
