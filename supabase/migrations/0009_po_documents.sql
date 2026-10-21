-- Documentos adjuntos por orden de compra: PO propia, invoice del proveedor, comprobante de pago.
create table if not exists po_documents (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  doc_type text not null check (doc_type in ('our_po', 'supplier_invoice', 'payment_proof', 'other')),
  file_path text not null unique,
  file_name text not null,
  size_bytes bigint,
  content_type text,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists po_documents_po_idx on po_documents(purchase_order_id);
alter table po_documents enable row level security;
create policy partners_all on po_documents for all to authenticated
  using ((select is_partner())) with check ((select is_partner()));

-- Bucket privado (documentos financieros): solo miembros leen y escriben. Máx 20 MB por archivo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('po-documents', 'po-documents', false, 20971520)
on conflict (id) do nothing;

create policy po_docs_member_select on storage.objects for select to authenticated
  using (bucket_id = 'po-documents' and (select public.is_partner()));
create policy po_docs_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'po-documents' and (select public.is_partner()));
create policy po_docs_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'po-documents' and (select public.is_partner()));
