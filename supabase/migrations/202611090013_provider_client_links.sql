-- Unconfigured retail pricing must not be represented as a free number.
alter table public.did_allocations alter column monthly_price drop not null;
alter table public.did_allocations alter column monthly_price drop default;

alter table public.provider_users add constraint provider_users_account_identity unique(id,provider_account_id);
create table public.provider_user_links (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references public.provider_accounts(id),
  provider_user_id uuid not null,
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.profiles(id),
  manager_id uuid references public.profiles(id),
  team_leader_id uuid references public.profiles(id),
  valid_from timestamptz not null,
  valid_to timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  is_seed boolean not null default false,
  foreign key(provider_user_id,provider_account_id) references public.provider_users(id,provider_account_id),
  check(valid_to is null or valid_to>valid_from)
);
create unique index one_current_provider_user_link on public.provider_user_links(provider_user_id) where valid_to is null;
create index provider_user_link_history on public.provider_user_links(provider_user_id,valid_from,valid_to);
alter table public.provider_user_links enable row level security;
revoke all on public.provider_user_links from public,anon,authenticated;
grant all on public.provider_user_links to service_role;
create trigger inherit_data_mode before insert or update on public.provider_user_links
  for each row execute function private.inherit_data_mode();

-- Resolve account-scoped, time-aware ownership. The local TelTel user is the
-- caller for outbound calls and the callee for inbound calls. Neither the remote
-- destination nor a different provider account may establish ownership.
create function private.resolve_call_owner(p_provider uuid,p_identity text,p_start timestamptz,p_direction text,p_raw jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  allocation public.did_allocations;
  linked public.provider_user_links;
  allocation_count integer;
  link_count integer;
  upstream_user text;
begin
  select count(*) into allocation_count from public.did_allocations a join public.did_numbers n on n.id=a.did_id
    where n.provider_account_id=p_provider and n.is_seed=private.demo_mode()
      and nullif(regexp_replace(n.number,'[^0-9]','','g'),'')=nullif(regexp_replace(p_identity,'[^0-9]','','g'),'')
      and a.valid_from<=p_start and (a.valid_to is null or a.valid_to>p_start);
  if allocation_count=1 then
    select a.* into allocation from public.did_allocations a join public.did_numbers n on n.id=a.did_id
      where n.provider_account_id=p_provider and n.is_seed=private.demo_mode()
        and nullif(regexp_replace(n.number,'[^0-9]','','g'),'')=nullif(regexp_replace(p_identity,'[^0-9]','','g'),'')
        and a.valid_from<=p_start and (a.valid_to is null or a.valid_to>p_start);
  end if;
  upstream_user:=case when p_direction='outbound' then p_raw->'caller'->>'user_id'
    when p_direction='inbound' then p_raw->'callee'->>'user_id' end;
  select count(*) into link_count from public.provider_user_links l join public.provider_users u on u.id=l.provider_user_id
    where l.provider_account_id=p_provider and u.provider_resource_id=upstream_user and l.is_seed=private.demo_mode()
      and l.valid_from<=p_start and (l.valid_to is null or l.valid_to>p_start);
  if link_count=1 then
    select l.* into linked from public.provider_user_links l join public.provider_users u on u.id=l.provider_user_id
      where l.provider_account_id=p_provider and u.provider_resource_id=upstream_user and l.is_seed=private.demo_mode()
        and l.valid_from<=p_start and (l.valid_to is null or l.valid_to>p_start);
  end if;
  if allocation_count>1 or link_count>1 then return jsonb_build_object('error','AMBIGUOUS_OWNERSHIP'); end if;
  if allocation.id is not null and linked.id is not null and (
    allocation.company_id<>linked.company_id or (allocation.user_id is not null and allocation.user_id<>linked.user_id)
  ) then return jsonb_build_object('error','OWNERSHIP_CONFLICT'); end if;
  if allocation.id is not null then
    return jsonb_build_object('company_id',allocation.company_id,'user_id',coalesce(allocation.user_id,linked.user_id),
      'manager_id',allocation.manager_id,'team_leader_id',allocation.team_leader_id,'allocation_id',allocation.id);
  end if;
  if linked.id is not null then
    return jsonb_build_object('company_id',linked.company_id,'user_id',linked.user_id,
      'manager_id',linked.manager_id,'team_leader_id',linked.team_leader_id,'allocation_id',null);
  end if;
  return jsonb_build_object('error','UNRESOLVED_OWNERSHIP');
end $$;
revoke all on function private.resolve_call_owner(uuid,text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function private.resolve_call_owner(uuid,text,timestamptz,text,jsonb) to service_role;

create or replace function public.import_call(p_provider uuid,p_call text,p_origin text,p_destination text,p_start timestamptz,p_end timestamptz,p_duration integer,p_direction text,p_status text,p_cost numeric,p_raw jsonb,p_identity text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ownership jsonb; v_call_id uuid; account_currency text;
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
  -- Re-imports preserve the existing ownership snapshot, including audited backfills.
  if exists(select 1 from public.calls c where c.id=v_call_id and c.company_id is null) then
    insert into public.billing_exceptions(provider_account_id,call_id,code)
      values(p_provider,v_call_id,coalesce(ownership->>'error','UNRESOLVED_OWNERSHIP')) on conflict(call_id,code) do nothing;
  end if;
  return v_call_id;
end $$;

-- Only an administrator may link a verified upstream email to a company member.
-- Backfill is explicit and limited to unowned, uncharged calls in that link's
-- effective window. Already assigned or billed history is never reassigned.
create function public.link_provider_user(p_provider_user uuid,p_user uuid,p_effective_from timestamptz default now(),p_backfill boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  upstream public.provider_users;
  member public.company_memberships;
  current_link public.provider_user_links;
  candidate record;
  ownership jsonb;
  linked_calls integer:=0;
  linked_devices integer:=0;
  email text;
begin
  if not private.platform_permission('providers.manage') or not private.platform_permission('users.manage') then raise exception 'FORBIDDEN'; end if;
  if p_effective_from is null or p_effective_from>now() then raise exception 'INVALID_REQUEST'; end if;
  select * into upstream from public.provider_users where id=p_provider_user for update;
  if not found or upstream.is_seed<>private.demo_mode() then raise exception 'NOT_FOUND'; end if;
  select u.email into email from auth.users u join public.profiles p on p.id=u.id where u.id=p_user and not p.suspended;
  if email is null or nullif(lower(btrim(upstream.raw->>'email')),'') is distinct from lower(email) then raise exception 'PROVIDER_EMAIL_MISMATCH'; end if;
  select m.* into member from public.company_memberships m join public.companies c on c.id=m.company_id
    where m.user_id=p_user and m.active and c.status in ('active','trial') and c.is_seed=upstream.is_seed;
  if not found then raise exception 'INVALID_MEMBER'; end if;
  if upstream.application_user_id is not null and upstream.application_user_id<>p_user then raise exception 'PROVIDER_LINK_CONFLICT'; end if;
  if exists(select 1 from public.provider_devices d where d.provider_account_id=upstream.provider_account_id
    and d.provider_user_resource_id=upstream.provider_resource_id and d.application_user_id is not null and d.application_user_id<>p_user)
    then raise exception 'PROVIDER_LINK_CONFLICT'; end if;
  select * into current_link from public.provider_user_links where provider_user_id=upstream.id and valid_to is null for update;
  if current_link.id is not null then
    if current_link.user_id<>p_user or current_link.company_id<>member.company_id or current_link.valid_from<>p_effective_from
      then raise exception 'PROVIDER_LINK_CONFLICT'; end if;
  else
    if exists(select 1 from public.provider_user_links l where l.provider_user_id=upstream.id
      and tstzrange(l.valid_from,l.valid_to,'[)') && tstzrange(p_effective_from,null,'[)')) then raise exception 'PROVIDER_LINK_CONFLICT'; end if;
    insert into public.provider_user_links(provider_account_id,provider_user_id,company_id,user_id,manager_id,team_leader_id,valid_from,created_by)
      values(upstream.provider_account_id,upstream.id,member.company_id,p_user,member.manager_id,member.team_leader_id,p_effective_from,auth.uid())
      returning * into current_link;
  end if;
  update public.provider_users set application_user_id=p_user where id=upstream.id;
  update public.provider_devices set application_user_id=p_user where provider_account_id=upstream.provider_account_id
    and provider_user_resource_id=upstream.provider_resource_id;
  get diagnostics linked_devices=row_count;
  if p_backfill then
    for candidate in
      select c.id,c.started_at,c.direction,p.raw from public.calls c join private.call_payloads p on p.call_id=c.id
      where c.provider_account_id=upstream.provider_account_id and c.company_id is null and c.user_id is null
        and c.started_at>=current_link.valid_from and (current_link.valid_to is null or c.started_at<current_link.valid_to)
        and c.billing_status='review' and not exists(select 1 from public.call_charges ch where ch.call_id=c.id)
        and case when c.direction='outbound' then p.raw->'caller'->>'user_id'
          when c.direction='inbound' then p.raw->'callee'->>'user_id' end=upstream.provider_resource_id
      for update of c
    loop
      ownership:=private.resolve_call_owner(upstream.provider_account_id,
        case when candidate.direction='outbound' then candidate.raw->'caller'->>'cid'
          when candidate.direction='inbound' then candidate.raw->'callee'->>'number' end,
        candidate.started_at,candidate.direction,candidate.raw);
      if (ownership->>'company_id')::uuid=member.company_id and (ownership->>'user_id')::uuid=p_user then
        update public.calls set company_id=member.company_id,user_id=p_user,manager_id=(ownership->>'manager_id')::uuid,
          team_leader_id=(ownership->>'team_leader_id')::uuid,allocation_id=(ownership->>'allocation_id')::uuid where id=candidate.id;
        update public.billing_exceptions set status='resolved' where call_id=candidate.id and code in ('UNRESOLVED_OWNERSHIP','AMBIGUOUS_OWNERSHIP');
        linked_calls:=linked_calls+1;
      end if;
    end loop;
  end if;
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(member.company_id,auth.uid(),'provider.user_linked',upstream.id,
      jsonb_build_object('application_user_id',p_user,'link_id',current_link.id,'effective_from',current_link.valid_from,
        'backfill_requested',p_backfill,'linked_calls',linked_calls,'linked_devices',linked_devices,'email_matched',true));
  return jsonb_build_object('link_id',current_link.id,'company_id',member.company_id,'user_id',p_user,'linked_calls',linked_calls,'linked_devices',linked_devices);
end $$;
revoke all on function public.link_provider_user(uuid,uuid,timestamptz,boolean) from public,anon;
grant execute on function public.link_provider_user(uuid,uuid,timestamptz,boolean) to authenticated,service_role;
