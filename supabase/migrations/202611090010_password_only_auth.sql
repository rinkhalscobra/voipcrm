-- Authentication uses the existing email/password session. Role checks, account
-- suspension, company isolation, and financial permissions still apply to it.
create or replace function private.platform_permission(p text) returns boolean language sql stable security definer set search_path = '' as $$
 select private.active_user() and exists(
 select 1 from public.profiles x where x.id=auth.uid() and (x.platform_role='super_admin' or (x.platform_role='platform_admin' and exists(select 1 from public.user_permissions u where u.user_id=x.id and u.permission=p and u.granted))))
$$;
create or replace function private.company_access(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select private.active_user() and exists(select 1 from public.company_memberships m join public.companies x on x.id=m.company_id where m.user_id=auth.uid() and m.company_id=c and m.active and x.status in ('active','trial'))
$$;
