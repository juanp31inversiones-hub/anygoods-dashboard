-- Categorías de banco creadas por el usuario (además de las fijas del tipo txn_category).
create table if not exists txn_categories (
  key text primary key,
  label text not null,
  direction text not null check (direction in ('in', 'out')),
  created_at timestamptz default now()
);
alter table txn_categories enable row level security;
create policy partners_all on txn_categories for all to authenticated using ((select is_partner())) with check ((select is_partner()));

-- Quita tildes sin depender de la extensión unaccent
create or replace function unaccent_safe(t text) returns text language sql immutable as $$
  select translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')
$$;

-- Crea una categoría nueva: agrega el valor al tipo y guarda su nombre. Devuelve la clave.
create or replace function add_txn_category(p_label text, p_direction text)
returns text language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not is_partner() then raise exception 'Sin acceso'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'La categoría necesita un nombre'; end if;
  k := 'c_' || left(regexp_replace(lower(unaccent_safe(trim(p_label))), '[^a-z0-9]+', '_', 'g'), 40);
  execute format('alter type txn_category add value if not exists %L', k);
  insert into txn_categories(key, label, direction) values (k, trim(p_label), p_direction) on conflict (key) do nothing;
  return k;
end $$;
grant execute on function add_txn_category(text, text) to authenticated;
