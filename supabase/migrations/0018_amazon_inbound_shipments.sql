-- Envíos a Amazon tal como los reporta Amazon (Fulfillment Inbound API). Se vinculan a fba_shipments por shipment_id.
create table if not exists amazon_inbound_shipments (
  shipment_id text primary key,
  name text,
  destination_fc text,
  status text not null,
  shipped_on date,
  items jsonb not null default '[]',   -- [{sku, shipped, received}]
  ignored boolean not null default false,
  synced_at timestamptz not null default now()
);
alter table amazon_inbound_shipments enable row level security;
create policy partners_all on amazon_inbound_shipments for all to authenticated using ((select is_partner())) with check ((select is_partner()));

-- Datos aplicados (oct-2026): inventario 2025 cerrado por producto en ventas Amazon (SP-API), reembolsos de Amazon
-- y "Desechado: defectuoso o vencido" (devueltas por Amazon y botadas por EC Access); servicios EC Access 2025 $1,378.35.
