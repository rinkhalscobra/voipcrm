-- Explicit overrides may grant or deny a tenant permission, while row scope remains mandatory.
create or replace function private.company_permission(c uuid,p text) returns boolean language sql stable security definer set search_path = '' as $$
 select private.company_access(c) and (
 exists(select 1 from public.company_memberships m join public.role_permissions r on r.role=m.role and r.permission=p where m.user_id=auth.uid() and m.company_id=c)
 or exists(select 1 from public.user_permissions u where u.user_id=auth.uid() and u.permission=p and u.granted))
 and not exists(select 1 from public.user_permissions u where u.user_id=auth.uid() and u.permission=p and not u.granted)
$$;
create or replace function public.my_context() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',p.id,'full_name',p.full_name,'platform_role',p.platform_role,'suspended',p.suspended,
 'membership',(select to_jsonb(m) from public.company_memberships m where m.user_id=p.id and m.active),
 'permissions',case when p.platform_role='super_admin' then (select jsonb_agg(key) from public.permissions) when p.platform_role='platform_admin' then (select coalesce(jsonb_agg(permission),'[]') from public.user_permissions where user_id=p.id and granted) else
 (select coalesce(jsonb_agg(distinct permission),'[]') from (
 select r.permission from public.company_memberships m join public.role_permissions r on r.role=m.role where m.user_id=p.id and m.active
 union select u.permission from public.user_permissions u where u.user_id=p.id and u.granted) allowed
 where not exists(select 1 from public.user_permissions u where u.user_id=p.id and u.permission=allowed.permission and not u.granted)) end)
 from public.profiles p where p.id=auth.uid() and not p.suspended
$$;
create function public.export_calls(p_from timestamptz,p_to timestamptz,p_status text default null,p_company uuid default null,p_search text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; n bigint;
begin
 if not private.platform_permission('reports.export') and not exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and private.company_permission(m.company_id,'reports.export')) then raise exception 'FORBIDDEN'; end if;
 if p_to<=p_from then raise exception 'INVALID_REQUEST'; end if;
 select count(*) into n from public.calls c where private.scope_access(c.company_id,c.user_id,c.manager_id,c.team_leader_id) and c.started_at>=p_from and c.started_at<p_to and (p_status is null or c.status=p_status) and (p_company is null or c.company_id=p_company) and (p_search is null or c.destination ilike '%'||p_search||'%');
 if n>10000 then raise exception 'EXPORT_LIMIT'; end if;
 select coalesce(jsonb_agg(to_jsonb(safe)),'[]') into result from (
 select c.id,c.started_at,c.origin,c.destination,c.direction,c.duration_seconds,c.status,c.customer_charge,c.currency
 from public.calls c where private.scope_access(c.company_id,c.user_id,c.manager_id,c.team_leader_id) and c.started_at>=p_from and c.started_at<p_to and (p_status is null or c.status=p_status) and (p_company is null or c.company_id=p_company) and (p_search is null or c.destination ilike '%'||p_search||'%') order by c.started_at desc,c.id
 ) safe;
 return jsonb_build_object('rows',result,'total',n);
end $$;
revoke all on function public.export_calls(timestamptz,timestamptz,text,uuid,text) from public,anon;
grant execute on function public.export_calls(timestamptz,timestamptz,text,uuid,text) to authenticated;
revoke all on all tables in schema private from anon,authenticated;
alter table public.customer_wallets add constraint wallet_balance_finite check(balance<>'NaN'::numeric);
alter table public.wallet_transactions add constraint ledger_amount_finite check(amount<>'NaN'::numeric and balance_after<>'NaN'::numeric);
alter table public.destination_rates add constraint rate_finite check(per_minute<>'NaN'::numeric and connection_fee<>'NaN'::numeric);
