-- A TelTel account belongs to a company. Client logins are independent and
-- receive access through explicit number assignments, never account-email matching.
alter table public.provider_accounts add column company_id uuid references public.companies(id);
create index provider_accounts_company on public.provider_accounts(company_id);

create function private.enforce_number_company() returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_company uuid;
begin
  select p.company_id into owner_company from public.did_numbers n join public.provider_accounts p on p.id=n.provider_account_id where n.id=new.did_id;
  if owner_company is not null and owner_company<>new.company_id then raise exception 'CLIENT_COMPANY_MISMATCH'; end if;
  return new;
end $$;
revoke all on function private.enforce_number_company() from public,anon,authenticated;
create trigger enforce_number_company before insert or update of did_id,company_id on public.did_allocations
  for each row execute function private.enforce_number_company();

create function private.reject_client_account_link() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.application_user_id is not null and exists(
    select 1 from public.company_memberships m where m.user_id=new.application_user_id and m.role='client'
  ) then raise exception 'CLIENT_NUMBER_ASSIGNMENT_REQUIRED'; end if;
  return new;
end $$;
revoke all on function private.reject_client_account_link() from public,anon,authenticated;
create trigger reject_client_account_link before insert or update of application_user_id on public.provider_users
  for each row execute function private.reject_client_account_link();

create function private.call_number_identity(p_direction text,p_raw jsonb,p_fallback text default null)
returns text language sql immutable set search_path = '' as $$
 select case when p_direction='outbound' then coalesce(nullif(p_raw->'caller'->>'cid',''),p_fallback)
   when p_direction='inbound' then coalesce(nullif(p_raw->'caller'->>'dnid',''),nullif(p_raw->'callee'->>'number',''),p_fallback) end
$$;
revoke all on function private.call_number_identity(text,jsonb,text) from public,anon,authenticated;
grant execute on function private.call_number_identity(text,jsonb,text) to service_role;

create or replace function private.resolve_call_owner(p_provider uuid,p_identity text,p_start timestamptz,p_direction text,p_raw jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  allocation public.did_allocations; linked public.provider_user_links;
  allocation_count integer; link_count integer; upstream_user text; number_identity text; account_company uuid;
begin
  select company_id into account_company from public.provider_accounts where id=p_provider;
  number_identity:=private.call_number_identity(p_direction,p_raw,p_identity);
  select count(*) into allocation_count from public.did_allocations a join public.did_numbers n on n.id=a.did_id
    where n.provider_account_id=p_provider and n.is_seed=private.demo_mode()
      and nullif(regexp_replace(n.number,'[^0-9]','','g'),'')=nullif(regexp_replace(number_identity,'[^0-9]','','g'),'')
      and a.valid_from<=p_start and (a.valid_to is null or a.valid_to>p_start);
  if allocation_count=1 then
    select a.* into allocation from public.did_allocations a join public.did_numbers n on n.id=a.did_id
      where n.provider_account_id=p_provider and n.is_seed=private.demo_mode()
        and nullif(regexp_replace(n.number,'[^0-9]','','g'),'')=nullif(regexp_replace(number_identity,'[^0-9]','','g'),'')
        and a.valid_from<=p_start and (a.valid_to is null or a.valid_to>p_start);
  end if;
  -- Legacy staff mappings remain supported. A client may never inherit a whole
  -- shared TelTel account, even if an old link or matching email is present.
  upstream_user:=case when p_direction='outbound' then p_raw->'caller'->>'user_id'
    when p_direction='inbound' then p_raw->'callee'->>'user_id' end;
  select count(*) into link_count from public.provider_user_links l join public.provider_users u on u.id=l.provider_user_id
    join public.company_memberships m on m.company_id=l.company_id and m.user_id=l.user_id and m.role<>'client'
    where account_company is null and l.provider_account_id=p_provider and u.provider_resource_id=upstream_user and l.is_seed=private.demo_mode()
      and l.valid_from<=p_start and (l.valid_to is null or l.valid_to>p_start);
  if link_count=1 then
    select l.* into linked from public.provider_user_links l join public.provider_users u on u.id=l.provider_user_id
      join public.company_memberships m on m.company_id=l.company_id and m.user_id=l.user_id and m.role<>'client'
      where account_company is null and l.provider_account_id=p_provider and u.provider_resource_id=upstream_user and l.is_seed=private.demo_mode()
        and l.valid_from<=p_start and (l.valid_to is null or l.valid_to>p_start);
  end if;
  if allocation_count>1 or link_count>1 then return jsonb_build_object('error','AMBIGUOUS_OWNERSHIP'); end if;
  if allocation.id is not null then
    if (account_company is not null and allocation.company_id<>account_company) or
      (linked.id is not null and (allocation.company_id<>linked.company_id or (allocation.user_id is not null and allocation.user_id<>linked.user_id)))
      then return jsonb_build_object('error','OWNERSHIP_CONFLICT'); end if;
    return jsonb_build_object('company_id',allocation.company_id,'user_id',coalesce(allocation.user_id,linked.user_id),
      'manager_id',allocation.manager_id,'team_leader_id',allocation.team_leader_id,'allocation_id',allocation.id);
  end if;
  if account_company is not null then return jsonb_build_object('company_id',account_company,'user_id',null,'error','UNASSIGNED_CLIENT'); end if;
  if linked.id is not null then return jsonb_build_object('company_id',linked.company_id,'user_id',linked.user_id,
    'manager_id',linked.manager_id,'team_leader_id',linked.team_leader_id,'allocation_id',null); end if;
  return jsonb_build_object('error','UNRESOLVED_OWNERSHIP');
end $$;

create or replace function public.import_call(p_provider uuid,p_call text,p_origin text,p_destination text,p_start timestamptz,p_end timestamptz,p_duration integer,p_direction text,p_status text,p_cost numeric,p_raw jsonb,p_identity text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ownership jsonb; v_call_id uuid; account_currency text; saved public.calls;
begin
  if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
  ownership:=private.resolve_call_owner(p_provider,p_identity,p_start,p_direction,p_raw);
  select currency into account_currency from public.provider_accounts where id=p_provider;
  insert into public.calls(provider_account_id,provider_resource_id,company_id,user_id,manager_id,team_leader_id,allocation_id,
    origin,destination,started_at,ended_at,duration_seconds,direction,status,provider_cost,currency)
  values(p_provider,p_call,(ownership->>'company_id')::uuid,(ownership->>'user_id')::uuid,(ownership->>'manager_id')::uuid,
    (ownership->>'team_leader_id')::uuid,(ownership->>'allocation_id')::uuid,p_origin,p_destination,p_start,p_end,p_duration,p_direction,p_status,p_cost,account_currency)
  on conflict(provider_account_id,provider_resource_id) do update set ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,
    status=excluded.status,provider_cost=excluded.provider_cost,synced_at=now() returning id into v_call_id;
  insert into private.call_payloads values(v_call_id,p_raw) on conflict(call_id) do update set raw=excluded.raw;
  select * into saved from public.calls where id=v_call_id;
  if saved.company_id is null or (saved.user_id is null and ownership->>'error'='UNASSIGNED_CLIENT') then
    insert into public.billing_exceptions(provider_account_id,company_id,call_id,code)
      values(p_provider,saved.company_id,v_call_id,coalesce(ownership->>'error','UNRESOLVED_OWNERSHIP')) on conflict(call_id,code) do nothing;
  end if;
  return v_call_id;
end $$;

create function public.assign_number_client(p_did uuid,p_client uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  previous public.did_allocations; target public.clients; member public.company_memberships;
  account_company uuid; target_company uuid; new_allocation uuid; stamp timestamptz;
begin
  select p.company_id into account_company from public.did_numbers n join public.provider_accounts p on p.id=n.provider_account_id
    where n.id=p_did and n.is_seed=private.demo_mode() for update of n;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into previous from public.did_allocations where did_id=p_did and valid_to is null for update;
  stamp:=clock_timestamp();
  if p_client is not null then
    select * into target from public.clients where id=p_client and is_seed=private.demo_mode();
    if not found then raise exception 'NOT_FOUND'; end if;
    target_company:=target.company_id;
    select m.* into member from public.company_memberships m join public.profiles p on p.id=m.user_id
      where m.company_id=target_company and m.user_id=target.user_id and m.role='client' and m.active and not p.suspended;
    if not found then raise exception 'INVALID_MEMBER'; end if;
  else target_company:=coalesce(account_company,previous.company_id); end if;
  if target_company is null then raise exception 'COMPANY_REQUIRED'; end if;
  if not private.platform_permission('numbers.manage') and not private.company_permission(target_company,'numbers.manage') then raise exception 'FORBIDDEN'; end if;
  if (account_company is not null and account_company<>target_company) or
    (previous.company_id is not null and previous.company_id<>target_company) then raise exception 'CLIENT_COMPANY_MISMATCH'; end if;
  if not exists(select 1 from public.companies where id=target_company and status in ('active','trial')) then raise exception 'COMPANY_INACTIVE'; end if;
  if previous.id is not null and previous.user_id is not distinct from target.user_id then return previous.id; end if;
  if previous.id is not null then
    update public.did_allocations set valid_to=stamp where id=previous.id;
    update public.caller_id_permissions set enabled=false where allocation_id=previous.id;
  end if;
  insert into public.did_allocations(did_id,company_id,user_id,manager_id,team_leader_id,monthly_price,valid_from)
    values(p_did,target_company,target.user_id,member.manager_id,member.team_leader_id,previous.monthly_price,stamp) returning id into new_allocation;
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(target_company,auth.uid(),'number.client_assigned',p_did,jsonb_build_object('client_id',p_client,'user_id',target.user_id,'allocation_id',new_allocation));
  return new_allocation;
end $$;
revoke all on function public.assign_number_client(uuid,uuid) from public,anon;
grant execute on function public.assign_number_client(uuid,uuid) to authenticated,service_role;

-- Include company-owned inventory before any client is assigned. Never expose
-- wholesale fields through this company inventory endpoint.
create function public.company_numbers(p_company uuid,p_search text default '',p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare total bigint; rows jsonb;
begin
  if not private.platform_permission('numbers.manage') and not private.company_permission(p_company,'numbers.manage') then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page<1 or p_page>100000 or p_limit is null or p_limit<1 or p_limit>500 or length(coalesce(p_search,''))>120 then raise exception 'INVALID_REQUEST'; end if;
  select count(*) into total from public.did_numbers n join public.provider_accounts p on p.id=n.provider_account_id
    where n.is_seed=private.demo_mode() and (p.company_id=p_company or exists(select 1 from public.did_allocations a where a.did_id=n.id and a.company_id=p_company and a.valid_to is null))
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(n.number))>0);
  select coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) into rows from (
    select n.id,n.number,n.country,n.provider_status,n.synced_at,p_company as company_id,
      (select name from public.companies where id=p_company) as company_name,
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'company_id',a.company_id,'user_id',a.user_id,'monthly_price',a.monthly_price,
        'valid_to',a.valid_to,'companies',jsonb_build_object('name',c.name))) from public.did_allocations a join public.companies c on c.id=a.company_id
        where a.did_id=n.id and a.company_id=p_company),'[]'::jsonb) as did_allocations
    from public.did_numbers n join public.provider_accounts p on p.id=n.provider_account_id
    where n.is_seed=private.demo_mode() and (p.company_id=p_company or exists(select 1 from public.did_allocations a where a.did_id=n.id and a.company_id=p_company and a.valid_to is null))
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(n.number))>0)
    order by n.synced_at desc,n.id limit p_limit offset (p_page-1)*p_limit
  ) result;
  return jsonb_build_object('rows',rows,'total',total);
end $$;
revoke all on function public.company_numbers(uuid,text,integer,integer) from public,anon;
grant execute on function public.company_numbers(uuid,text,integer,integer) to authenticated,service_role;
