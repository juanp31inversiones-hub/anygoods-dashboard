-- Vincula el login de Supabase Auth con el socio por email (sin registro abierto de datos).
alter table partners add column if not exists email text unique;

create or replace function public.claim_partner() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower((select auth.jwt() ->> 'email'));
begin
  update public.partners set user_id = (select auth.uid())
  where lower(email) = v_email and user_id is null;
  return exists (select 1 from public.partners where user_id = (select auth.uid()));
end $$;

revoke execute on function public.claim_partner() from public, anon;
grant execute on function public.claim_partner() to authenticated;
