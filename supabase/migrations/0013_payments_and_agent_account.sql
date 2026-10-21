-- Pagos de cada compra (banco, tarjeta, pagado por un tercero, nota crédito) y cuenta con terceros
-- que manejan dinero de AnyGoods (ej. EC Access: depósitos, liquidaciones cobradas, pagos por cuenta nuestra).

create table if not exists po_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'bank' check (method in ('bank', 'card', 'third_party', 'credit_note', 'other')),
  paid_by_id uuid references counterparties(id),          -- tercero que pagó por nosotros (method = third_party)
  bank_transaction_id uuid references bank_transactions(id),
  notes text,
  created_at timestamptz default now()
);
create index if not exists po_payments_po_idx on po_payments(purchase_order_id);
create index if not exists po_payments_paid_by_idx on po_payments(paid_by_id);
create index if not exists po_payments_txn_idx on po_payments(bank_transaction_id);

-- Dinero que un tercero cobró o recibió a nuestro favor (ej. venta de liquidación).
create table if not exists agent_entries (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references counterparties(id),
  entry_date date not null,
  kind text not null default 'liquidation' check (kind in ('liquidation', 'other_income', 'fee', 'adjustment')),
  amount numeric(12,2) not null,                          -- positivo: a nuestro favor; negativo: cobro del tercero
  description text,
  created_at timestamptz default now()
);
create index if not exists agent_entries_cp_idx on agent_entries(counterparty_id);

alter table po_payments enable row level security;
alter table agent_entries enable row level security;
create policy partners_all on po_payments for all to authenticated using ((select is_partner())) with check ((select is_partner()));
create policy partners_all on agent_entries for all to authenticated using ((select is_partner())) with check ((select is_partner()));

-- Estado de pago por compra: total (compra neta + costos del proveedor), pagado y saldo.
create or replace view v_po_payment_status with (security_invoker = on) as
select po.id purchase_order_id,
  coalesce((select sum(l.units * l.unit_cost) from purchase_order_lines l where l.purchase_order_id = po.id), 0)
  + coalesce((select sum(c.amount) from additional_costs c where c.purchase_order_id = po.id and c.moved_to_shipment_id is null
              and (c.counterparty_id is null or c.counterparty_id = po.supplier_id)), 0) total,
  coalesce((select sum(p.amount) from po_payments p where p.purchase_order_id = po.id), 0) paid
from purchase_orders po;

-- Cuenta con terceros: lo que les dimos + lo que cobraron a nuestro favor − lo que pagaron por nosotros − lo que nos devolvieron.
create or replace view v_agent_balance with (security_invoker = on) as
with agents as (
  select distinct id from (
    select paid_via_id id from purchase_orders where paid_via_id is not null
    union select paid_by_id from po_payments where paid_by_id is not null
    union select counterparty_id from agent_entries
  ) x
)
select c.name agent,
  coalesce((select -sum(t.amount) from bank_transactions t where t.counterparty_id = c.id and t.category = 'inventory'), 0) deposited,
  -- Compras antiguas marcadas "pagada vía" + pagos registrados como hechos por el tercero
  coalesce((select sum(l.units * l.unit_cost) from purchase_orders po join purchase_order_lines l on l.purchase_order_id = po.id
            where po.paid_via_id = c.id and not exists (select 1 from po_payments pp where pp.purchase_order_id = po.id)), 0)
  + coalesce((select sum(ac.amount) from additional_costs ac join purchase_orders po on po.id = ac.purchase_order_id
              where po.paid_via_id = c.id and ac.cost_type = 'supplier_shipping' and ac.moved_to_shipment_id is null
                and not exists (select 1 from po_payments pp where pp.purchase_order_id = po.id)), 0)
  + coalesce((select sum(pp.amount) from po_payments pp where pp.paid_by_id = c.id and pp.method = 'third_party'), 0) spent_on_purchases,
  c.id counterparty_id,
  coalesce((select sum(e.amount) from agent_entries e where e.counterparty_id = c.id), 0) collected_for_us,
  coalesce((select sum(t.amount) from bank_transactions t where t.counterparty_id = c.id and t.amount > 0), 0) returned_to_us
from counterparties c join agents a on a.id = c.id;

-- Datos aplicados (oct-2026):
-- * PO1013: pagos Mercury $10 + $3,990 (xls-ig-131/132) y $1,005 pagados por EC Access (1-oct-2026).
-- * Pagos bancarios vinculados automáticamente por monto exacto (PO1011, PO1015, PO1016).
-- * Compras de 2025 "pagadas vía" EC Access registradas como pagos de terceros.
-- * EC Access: liquidación cobrada a nuestro favor $1,688 (PDF ANY GOODS LIQUIDATION, 9 productos, 1,838 und),
--   con salidas de inventario 'liquidation' desde prep_center y precio por unidad.
