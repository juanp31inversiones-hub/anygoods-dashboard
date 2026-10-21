-- Datos de Amazon (SP-API): SKUs, inventario FBA, eventos financieros y bitácora de sincronización.

-- SKUs de Amazon vinculados a nuestros productos (por ASIN automáticamente, o manual).
create table if not exists amazon_listings (
  sku text primary key,
  asin text,
  fnsku text,
  title text,
  product_id uuid references products(id),
  updated_at timestamptz default now()
);
create index if not exists amazon_listings_product_idx on amazon_listings(product_id);

-- Último inventario FBA reportado por Amazon por SKU.
create table if not exists amazon_inventory (
  sku text primary key references amazon_listings(sku),
  fulfillable int not null default 0,
  inbound_working int not null default 0,
  inbound_shipped int not null default 0,
  inbound_receiving int not null default 0,
  reserved int not null default 0,
  unfulfillable int not null default 0,
  researching int not null default 0,
  total int not null default 0,
  synced_at timestamptz not null default now()
);

-- Eventos financieros (ventas, devoluciones, reembolsos, cargos) por SKU.
create table if not exists amazon_financial_events (
  id text primary key,                     -- clave estable para no duplicar
  event_type text not null,                -- shipment | refund | adjustment | service_fee | other
  posted_date timestamptz not null,
  order_id text,
  sku text,
  quantity int,
  principal numeric(12,2) default 0,       -- precio de venta
  tax numeric(12,2) default 0,
  shipping numeric(12,2) default 0,
  promotion numeric(12,2) default 0,
  fba_fee numeric(12,2) default 0,         -- fulfillment fee
  referral_fee numeric(12,2) default 0,    -- comisión de Amazon
  other_fees numeric(12,2) default 0,
  total numeric(12,2) default 0,           -- neto que Amazon nos acredita (o cobra)
  description text,
  raw jsonb
);
create index if not exists amazon_fin_events_posted_idx on amazon_financial_events(posted_date);
create index if not exists amazon_fin_events_sku_idx on amazon_financial_events(sku);

-- Bitácora y estado de sincronización (cursor de finanzas).
create table if not exists amazon_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                      -- connection | inventory | finances
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running | ok | partial | error
  records int default 0,
  message text
);
create table if not exists amazon_sync_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table amazon_listings enable row level security;
alter table amazon_inventory enable row level security;
alter table amazon_financial_events enable row level security;
alter table amazon_sync_runs enable row level security;
alter table amazon_sync_state enable row level security;
create policy partners_all on amazon_listings for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on amazon_inventory for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on amazon_financial_events for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on amazon_sync_runs for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on amazon_sync_state for all to authenticated using ((select is_partner())) with check ((select is_partner()));

-- Rentabilidad por SKU desde los eventos financieros
create or replace view v_amazon_sku_profit with (security_invoker = on) as
select e.sku, l.product_id, l.asin, l.title,
  coalesce(sum(e.quantity) filter (where e.event_type = 'shipment'), 0) units_sold,
  coalesce(sum(e.quantity) filter (where e.event_type = 'refund'), 0) units_refunded,
  coalesce(sum(e.principal + e.shipping + e.promotion), 0) revenue,
  coalesce(sum(e.fba_fee), 0) fba_fees,
  coalesce(sum(e.referral_fee), 0) referral_fees,
  coalesce(sum(e.other_fees), 0) other_fees,
  coalesce(sum(e.total), 0) net_proceeds,
  min(e.posted_date) first_sale, max(e.posted_date) last_sale
from amazon_financial_events e left join amazon_listings l on l.sku = e.sku
where e.sku is not null and e.event_type in ('shipment', 'refund', 'adjustment')
group by e.sku, l.product_id, l.asin, l.title;
