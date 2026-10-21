-- Fase A: administración completa (CRUD) desde la app.

-- Imágenes y datos extra de producto
alter table products add column if not exists image_url text;
alter table products add column if not exists notes text;
alter table counterparties add column if not exists contact_name text;
alter table counterparties add column if not exists email text;
alter table counterparties add column if not exists phone text;
alter table counterparties add column if not exists website text;
alter table inventory_movements add column if not exists notes text;

-- Bucket público de imágenes de producto (las imágenes no son sensibles); solo miembros escriben.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy product_images_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_partner()));
create policy product_images_member_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_partner()));
create policy product_images_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_partner()));

-- Inventario valorizado a costo promedio ponderado del producto (incluye ajustes sin lote).
create or replace view v_inventory_on_hand with (security_invoker = on) as
with cost as (
  select product_id, sum(units * landed_unit_cost) / nullif(sum(units), 0) avg_cost
  from purchase_order_lines where landed_unit_cost is not null group by product_id
), qty as (
  select product_id,
    sum(qty) units_on_hand,
    sum(qty) filter (where location = 'amazon_fba') units_fba,
    sum(qty) filter (where location <> 'amazon_fba') units_other
  from inventory_movements group by product_id
)
select p.id product_id, p.description, p.upc, p.asin,
  coalesce(q.units_on_hand, 0) units_on_hand,
  coalesce(q.units_on_hand, 0) * coalesce(c.avg_cost, 0) inventory_value,
  p.retail_price,
  coalesce(q.units_fba, 0) units_fba,
  coalesce(q.units_other, 0) units_other,
  p.image_url,
  c.avg_cost,
  p.active
from products p
left join qty q on q.product_id = p.id
left join cost c on c.product_id = p.id;

-- Guarda una orden de compra con sus líneas de forma atómica.
-- p = {id?, supplier_id, paid_via_id?, po_number?, invoice_number?, purchase_date, arrival_date?, status,
--      supplier_shipping, amazon_shipping, amazon_placement_fee, prep_cost, notes?, location,
--      lines: [{id?, product_id, cases?, units, unit_cost}]}
create or replace function public.save_purchase_order(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_loc text := coalesce(nullif(p->>'location', ''), 'amazon_fba');
  v_date date;
  l jsonb;
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
    supplier_shipping = coalesce(nullif(p->>'supplier_shipping', '')::numeric, 0),
    amazon_shipping = coalesce(nullif(p->>'amazon_shipping', '')::numeric, 0),
    amazon_placement_fee = coalesce(nullif(p->>'amazon_placement_fee', '')::numeric, 0),
    prep_cost = coalesce(nullif(p->>'prep_cost', '')::numeric, 0),
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

  -- Las líneas eliminadas las borra la app (lib/actions.ts) antes de llamar esta función.
  perform allocate_po_costs(v_id);
  return v_id;
end $$;

revoke execute on function public.save_purchase_order(jsonb) from public, anon;
grant execute on function public.save_purchase_order(jsonb) to authenticated;
grant execute on function public.allocate_po_costs(uuid) to authenticated;
