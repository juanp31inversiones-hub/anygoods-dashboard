-- Liquidaciones (settlements) de Amazon y su cruce con movimientos de Mercury.
create table if not exists amazon_payouts (
  group_id text primary key,
  processing_status text,
  fund_transfer_status text,
  period_start timestamptz,
  period_end timestamptz,
  fund_transfer_date timestamptz,
  amount numeric(12,2),
  currency text,
  beginning_balance numeric(12,2),
  trace_id text,
  account_tail text,
  bank_transaction_id uuid references bank_transactions(id),
  synced_at timestamptz default now()
);
create index if not exists amazon_payouts_txn_idx on amazon_payouts(bank_transaction_id);
alter table amazon_payouts enable row level security;
create policy partners_all on amazon_payouts for all to authenticated using ((select is_partner())) with check ((select is_partner()));
