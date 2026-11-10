-- Demo and live records share infrastructure but never an operational dataset.
-- Mode changes preserve existing records; no ledger or ownership history is deleted.
create function private.demo_mode() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select value #>> '{}' from public.system_settings where key='data_mode'),'live')='demo'
$$;
revoke all on function private.demo_mode() from public,anon,authenticated;

do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('platform_roles','permissions','role_permissions','user_permissions','system_settings') loop
 execute format('alter table public.%I add column if not exists is_seed boolean not null default false',t.tablename);
 end loop;
end $$;

create function private.inherit_data_mode() returns trigger language plpgsql security definer set search_path = '' as $$
declare payload jsonb:=to_jsonb(new); marker boolean; candidate boolean; parent_id uuid;
begin
 if tg_op='UPDATE' and old.is_seed<>private.demo_mode() then raise exception 'DATA_MODE_MISMATCH'; end if;
 if tg_table_name in ('companies','provider_accounts') then
 marker:=new.is_seed;
 else
 if nullif(payload->>'company_id','') is not null then
 select is_seed into marker from public.companies where id=(payload->>'company_id')::uuid;
 end if;
 if nullif(payload->>'provider_account_id','') is not null then
 select is_seed into candidate from public.provider_accounts where id=(payload->>'provider_account_id')::uuid;
 if marker is not null and candidate is distinct from marker then raise exception 'DATA_MODE_MISMATCH'; end if;
 marker:=coalesce(marker,candidate);
 end if;
 if nullif(payload->>'did_id','') is not null then
 select is_seed into candidate from public.did_numbers where id=(payload->>'did_id')::uuid;
 if marker is not null and candidate is distinct from marker then raise exception 'DATA_MODE_MISMATCH'; end if;
 marker:=coalesce(marker,candidate);
 end if;
 if marker is null and nullif(payload->>'call_id','') is not null then select is_seed into marker from public.calls where id=(payload->>'call_id')::uuid; end if;
 if marker is null and nullif(payload->>'plan_id','') is not null then select is_seed into marker from public.pricing_plans where id=(payload->>'plan_id')::uuid; end if;
 if marker is null and nullif(payload->>'version_id','') is not null then select is_seed into marker from public.pricing_plan_versions where id=(payload->>'version_id')::uuid; end if;
 if marker is null and nullif(payload->>'order_id','') is not null then select is_seed into marker from public.did_orders where id=(payload->>'order_id')::uuid; end if;
 marker:=coalesce(marker,private.demo_mode());
 end if;
 if marker<>private.demo_mode() then raise exception 'DATA_MODE_MISMATCH'; end if;
 new.is_seed:=marker;
 return new;
end $$;
revoke all on function private.inherit_data_mode() from public,anon,authenticated;
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('profiles','platform_roles','permissions','role_permissions','user_permissions','system_settings') loop
 execute format('create trigger inherit_data_mode before insert or update on public.%I for each row execute function private.inherit_data_mode()',t.tablename);
 end loop;
end $$;
grant select(is_seed) on public.calls,public.profiles to authenticated;
create index calls_data_mode_time on public.calls(is_seed,started_at desc);
create index numbers_data_mode on public.did_numbers(is_seed,provider_status);
create index wallets_data_mode on public.customer_wallets(is_seed,company_id);

create or replace function public.my_numbers() returns table(id uuid,number text,country text,company_id uuid,user_id uuid,status text,monthly_price numeric,synced_at timestamptz) language sql stable security definer set search_path = '' as $$
 select n.id,n.number,n.country,a.company_id,a.user_id,n.provider_status,a.monthly_price,n.synced_at
 from public.did_numbers n join public.did_allocations a on a.did_id=n.id and a.valid_to is null
 where n.is_seed=private.demo_mode() and private.scope_access(a.company_id,a.user_id,a.manager_id,a.team_leader_id)
$$;

drop function public.create_company(text,text,text,text,text);
create function public.create_company(p_name text,p_slug text,p_email text,p_country text,p_currency text,p_is_seed boolean default false) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
 if not private.platform_permission('companies.manage') then raise exception 'FORBIDDEN'; end if;
 if p_is_seed<>private.demo_mode() then raise exception 'DATA_MODE_MISMATCH'; end if;
 insert into public.companies(name,slug,contact_email,country,currency,is_seed) values(p_name,p_slug,p_email,p_country,p_currency,p_is_seed) returning id into c;
 insert into public.customer_wallets(company_id,currency) values(c,p_currency);
 insert into public.audit_logs(actor_id,action,resource_id,company_id) values(auth.uid(),'company.created',c,c);
 return c;
end $$;
revoke all on function public.create_company(text,text,text,text,text,boolean) from public,anon;
grant execute on function public.create_company(text,text,text,text,text,boolean) to authenticated,service_role;

create or replace function public.create_provider(p_id uuid,p_name text,p_currency text,p_ciphertext text) returns uuid language plpgsql security definer set search_path = '' as $$
begin
 if not private.platform_permission('providers.manage') then raise exception 'FORBIDDEN'; end if;
 if private.demo_mode() then raise exception 'DEMO_PROVIDER_DISABLED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-onboarding',0));
 if exists(select 1 from public.provider_accounts where not is_seed) and not exists(select 1 from public.provider_accounts where verified_resources @> array['balance','users','devices','dids','calls'] and not is_seed) then raise exception 'FIRST_ACCOUNT_UNVERIFIED'; end if;
 insert into public.provider_accounts(id,name,currency) values(p_id,p_name,p_currency);
 insert into private.provider_credentials(provider_account_id,ciphertext) values(p_id,p_ciphertext);
 insert into public.audit_logs(actor_id,action,resource_id) values(auth.uid(),'provider.created',p_id);
 return p_id;
end $$;

create or replace function public.export_calls(p_from timestamptz,p_to timestamptz,p_status text default null,p_company uuid default null,p_search text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; n bigint;
begin
 if not private.platform_permission('reports.export') and not exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and private.company_permission(m.company_id,'reports.export')) then raise exception 'FORBIDDEN'; end if;
 if p_to<=p_from then raise exception 'INVALID_REQUEST'; end if;
 select count(*) into n from public.calls c where c.is_seed=private.demo_mode() and private.scope_access(c.company_id,c.user_id,c.manager_id,c.team_leader_id) and c.started_at>=p_from and c.started_at<p_to and (p_status is null or c.status=p_status) and (p_company is null or c.company_id=p_company) and (p_search is null or c.destination ilike '%'||p_search||'%');
 if n>10000 then raise exception 'EXPORT_LIMIT'; end if;
 select coalesce(jsonb_agg(to_jsonb(safe)),'[]') into result from (
 select c.id,c.started_at,c.origin,c.destination,c.direction,c.duration_seconds,c.status,c.customer_charge,c.currency
 from public.calls c where c.is_seed=private.demo_mode() and private.scope_access(c.company_id,c.user_id,c.manager_id,c.team_leader_id) and c.started_at>=p_from and c.started_at<p_to and (p_status is null or c.status=p_status) and (p_company is null or c.company_id=p_company) and (p_search is null or c.destination ilike '%'||p_search||'%') order by c.started_at desc,c.id
 ) safe;
 return jsonb_build_object('rows',result,'total',n);
end $$;
