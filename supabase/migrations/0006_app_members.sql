-- Acceso a la app separado de los socios: permite correos compartidos de la empresa
-- (y más adelante contador/VA) sin atarlos a un socio.
create table if not exists app_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  user_id uuid unique references auth.users(id),
  role text not null default 'admin',
  partner_id uuid references partners(id),   -- opcional: si el usuario es un socio
  created_at timestamptz default now()
);
alter table app_members enable row level security;
create index if not exists app_members_partner_id_idx on app_members(partner_id);

create or replace function public.is_partner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_members where user_id = (select auth.uid()))
$$;

create or replace function public.claim_partner() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower((select auth.jwt() ->> 'email'));
begin
  update public.app_members set user_id = (select auth.uid())
  where lower(email) = v_email and user_id is null;
  return exists (select 1 from public.app_members where user_id = (select auth.uid()));
end $$;

create policy members_read_self on app_members for select to authenticated using (user_id = (select auth.uid()));

insert into app_members (email) values ('admin1@any-goods.com'), ('info@any-goods.com')
on conflict (email) do nothing;
