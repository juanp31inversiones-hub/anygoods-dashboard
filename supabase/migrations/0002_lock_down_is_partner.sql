-- is_partner() solo la necesitan las políticas RLS de usuarios autenticados.
revoke execute on function public.is_partner() from public, anon;
revoke execute on function public.allocate_po_costs(uuid) from public, anon;
