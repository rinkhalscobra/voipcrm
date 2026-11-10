-- Auth can return a generic database error for duplicate-email admin updates.
-- Resolve the conflict on the server without exposing the Auth user directory.
create function public.client_email_in_use(p_email text,p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user is null or p_email is null or length(btrim(p_email)) not between 3 and 320 then raise exception 'INVALID_REQUEST'; end if;
  return exists(select 1 from auth.users u where lower(u.email)=lower(btrim(p_email)) and u.id<>p_user);
end $$;
revoke all on function public.client_email_in_use(text,uuid) from public,anon,authenticated;
grant execute on function public.client_email_in_use(text,uuid) to service_role;
