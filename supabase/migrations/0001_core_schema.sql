-- AnyGoods Dashboard: esquema base (Fase 1 compras/inventario + Fase 2 banco)
-- Derivado de "Product_Inventory_ANY_GOODS" (hoja Purchases) y "ANY_GOODS_ADMIN" (hoja I+G).

-- ===== Socios y acceso =====
create table partners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  short_name text not null unique,          -- "Juan Pedro", "Juan Pablo", "Simon", "Sebastian"
  ownership_pct numeric(6,4) not null,      -- 0.3333
  user_id uuid references auth.users(id),   -- login en la app
  created_at timestamptz default now()
);

-- ===== Contrapartes: proveedores, marcas, herramientas, Amazon, etc. =====
create type counterparty_kind as enum ('supplier','brand','marketplace','service','partner','other');
create table counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                -- "Estmed Brands Inc", "Keepa", "Amazon"
  kind counterparty_kind not null default 'other',
  notes text,
  created_at timestamptz default now()
);

-- ===== Catálogo =====
create table products (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  upc text unique,
  asin text,
  sku text,
  brand text,
  units_per_case int,
  retail_price numeric(12,2),
  active boolean default true,
  created_at timestamptz default now()
);

-- ===== Órdenes de compra (una por factura del proveedor) =====
create type po_status as enum ('draft','ordered','received','sent_to_amazon','closed','cancelled');
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references counterparties(id),
  po_number text,
  invoice_number text,
  purchase_date date not null,
  arrival_date date,
  status po_status not null default 'ordered',
  supplier_shipping numeric(12,2) default 0,   -- "Supplier Transport"
  amazon_shipping numeric(12,2) default 0,     -- "Amazon Transport"
  amazon_placement_fee numeric(12,2) default 0,-- "Amazon Inbound Placement"
  prep_cost numeric(12,2) default 0,
  notes text,
  created_at timestamptz default now()
);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  cases numeric(10,2),
  units int not null,
  unit_cost numeric(12,4) not null,          -- costo proveedor por unidad
  allocated_costs numeric(12,2) default 0,   -- fletes/fees prorrateados (calculado)
  landed_unit_cost numeric(12,4)             -- "Final Unit Price" (calculado)
);

-- Prorratea costos logísticos de la PO por valor de producto y calcula landed cost.
create or replace function allocate_po_costs(p_po uuid) returns void language plpgsql set search_path = public as $$
declare v_extra numeric; v_total numeric;
begin
  select coalesce(supplier_shipping,0)+coalesce(amazon_shipping,0)+coalesce(amazon_placement_fee,0)+coalesce(prep_cost,0)
    into v_extra from purchase_orders where id = p_po;
  select sum(units*unit_cost) into v_total from purchase_order_lines where purchase_order_id = p_po;
  update purchase_order_lines l set
    allocated_costs = case when v_total > 0 then round(v_extra * (l.units*l.unit_cost)/v_total, 2) else 0 end,
    landed_unit_cost = l.unit_cost + case when v_total > 0 and l.units > 0
      then v_extra * l.unit_cost / v_total else 0 end
  where purchase_order_id = p_po;
end $$;

-- ===== Movimientos de inventario (ventas, devoluciones, liquidaciones, ajustes) =====
create type inventory_move as enum ('purchase','sale','customer_return','removal','liquidation','damaged','reimbursed','adjustment');
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  po_line_id uuid references purchase_order_lines(id),  -- lote de origen (FIFO)
  movement inventory_move not null,
  qty int not null,                         -- positivo entra, negativo sale
  unit_price numeric(12,4),                 -- precio de venta o liquidación
  occurred_on date not null,
  channel text default 'amazon',            -- amazon, ebay, liquidacion, otro
  reference text,                           -- order id / settlement id
  created_at timestamptz default now()
);

-- ===== Banco (reemplaza I+G) =====
create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                -- "Mercury"
  currency text default 'USD'
);

create type txn_category as enum (
  'capital_contribution',  -- Aporte socio
  'capital_return',        -- Devolución a socio
  'amazon_payout','other_sales',
  'inventory','shipping','software','legal','fees','other_expense','transfer'
);
create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id),
  txn_date date not null,
  description text not null,
  amount numeric(12,2) not null,            -- positivo ingreso, negativo egreso
  category txn_category,
  counterparty_id uuid references counterparties(id),
  partner_id uuid references partners(id),  -- para aportes/devoluciones
  purchase_order_id uuid references purchase_orders(id), -- conciliación con compras
  external_id text unique,                  -- id del banco para evitar duplicados al importar
  notes text,
  created_at timestamptz default now()
);

create index on purchase_orders(supplier_id);
create index on purchase_order_lines(purchase_order_id);
create index on purchase_order_lines(product_id);
create index on inventory_movements(product_id);
create index on inventory_movements(po_line_id);
create index on bank_transactions(bank_account_id);
create index on bank_transactions(counterparty_id);
create index on bank_transactions(partner_id);
create index on bank_transactions(purchase_order_id);
create index on bank_transactions(txn_date);
create index on partners(user_id);

-- ===== Vistas de negocio =====
create view v_inventory_on_hand as
select p.id product_id, p.description, p.upc, p.asin,
  coalesce(sum(m.qty),0) units_on_hand,
  coalesce(sum(m.qty * l.landed_unit_cost),0) inventory_value
from products p
left join inventory_movements m on m.product_id = p.id
left join purchase_order_lines l on l.id = m.po_line_id
group by p.id;

create view v_partner_capital as
select pa.short_name, pa.ownership_pct,
  coalesce(sum(t.amount) filter (where t.category='capital_contribution'),0) contributed,
  coalesce(-sum(t.amount) filter (where t.category='capital_return'),0) returned,
  coalesce(sum(t.amount) filter (where t.category in ('capital_contribution','capital_return')),0) net_capital
from partners pa left join bank_transactions t on t.partner_id = pa.id
group by pa.id;

create view v_monthly_cashflow as
select date_trunc('month', txn_date)::date as month,
  sum(amount) filter (where category in ('amazon_payout','other_sales')) as operating_income,
  -sum(amount) filter (where amount < 0 and category not in ('capital_return','transfer')) as operating_expenses,
  sum(amount) filter (where category in ('capital_contribution','capital_return')) as net_capital_flow,
  sum(amount) as net_cash_change
from bank_transactions group by 1 order by 1;

-- ===== Seguridad: solo socios autenticados =====
create or replace function is_partner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.partners where user_id = (select auth.uid()))
$$;

do $$ declare t text; begin
  foreach t in array array['partners','counterparties','products','purchase_orders','purchase_order_lines',
                           'inventory_movements','bank_accounts','bank_transactions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy partners_all on %I for all to authenticated using ((select is_partner())) with check ((select is_partner()))', t);
  end loop;
end $$;

alter view v_inventory_on_hand set (security_invoker = on);
alter view v_partner_capital set (security_invoker = on);
alter view v_monthly_cashflow set (security_invoker = on);

-- ===== Datos iniciales =====
insert into partners (full_name, short_name, ownership_pct) values
  ('Juan Pedro Henriquez Kitchen','Juan Pedro',0.3333),
  ('Juan Pablo Velasquez Sanchez','Juan Pablo',0.3333),
  ('Simon Velasquez Sanchez','Simon',0.1667),
  ('Sebastian Aristizabal Carmona','Sebastian',0.1667);
insert into bank_accounts (name) values ('Mercury');
