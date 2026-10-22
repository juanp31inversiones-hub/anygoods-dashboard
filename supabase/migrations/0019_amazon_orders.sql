-- Pedidos de Amazon por fecha de compra (Orders API), para ver las ventas como en Seller Central.
create table if not exists amazon_orders (
  order_id text primary key,
  purchase_date timestamptz not null,
  status text not null,
  fulfillment_channel text,
  order_total numeric(12,2),
  last_update timestamptz,
  items jsonb not null default '[]',   -- [{sku, asin, title, qty, price}]
  items_synced boolean not null default false,
  synced_at timestamptz not null default now()
);
create index if not exists amazon_orders_purchase_idx on amazon_orders(purchase_date);
alter table amazon_orders enable row level security;
create policy partners_all on amazon_orders for all to authenticated using ((select is_partner())) with check ((select is_partner()));
