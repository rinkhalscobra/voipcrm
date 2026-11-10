-- Companies contain clients. A client is a separate end-user identity, not a
-- company administrator or an employee with company-wide access.
insert into public.platform_roles(name) values('client');
insert into public.role_permissions(role,permission) values
  ('client','calls.read'),('client','calls.initiate'),('client','reports.export');
alter table public.company_memberships drop constraint company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check(role in ('company_admin','manager','team_leader','agent','client'));
alter table public.user_invitations drop constraint user_invitations_role_check;
alter table public.user_invitations add constraint user_invitations_role_check
  check(role in ('company_admin','manager','team_leader','agent','client'));

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null unique references public.profiles(id),
  name text not null check(length(btrim(name)) between 2 and 160),
  created_at timestamptz not null default now(),
  is_seed boolean not null default false,
  foreign key(company_id,user_id) references public.company_memberships(company_id,user_id)
);
create index clients_company on public.clients(company_id,created_at);
alter table public.clients enable row level security;
revoke all on public.clients from public,anon,authenticated;
grant select on public.clients to authenticated;
grant all on public.clients to service_role;
create policy clients_read on public.clients for select using(
  private.platform_permission('users.manage') or private.company_permission(company_id,'users.manage')
  or (user_id=auth.uid() and private.company_access(company_id))
);
create trigger inherit_data_mode before insert or update on public.clients
  for each row execute function private.inherit_data_mode();

create function private.ensure_client_identity() returns trigger language plpgsql security definer set search_path = '' as $$
declare client_name text;
begin
  if new.role='client' then
    if exists(select 1 from public.profiles where id=new.user_id and platform_role is not null) then raise exception 'CLIENT_ROLE_MISMATCH'; end if;
    if exists(select 1 from public.clients where user_id=new.user_id and company_id<>new.company_id) then raise exception 'CLIENT_COMPANY_MISMATCH'; end if;
    select coalesce(nullif(btrim(full_name),''),'Client') into client_name from public.profiles where id=new.user_id;
    insert into public.clients(company_id,user_id,name) values(new.company_id,new.user_id,left(client_name,160)) on conflict(user_id) do nothing;
  elsif exists(select 1 from public.clients where user_id=new.user_id) then
    raise exception 'CLIENT_ROLE_MISMATCH';
  end if;
  return new;
end $$;
revoke all on function private.ensure_client_identity() from public,anon,authenticated;
create trigger ensure_client_identity after insert or update of role,company_id,user_id on public.company_memberships
  for each row execute function private.ensure_client_identity();

-- Email comes from Auth; client names and company names can be changed independently.
create function public.list_clients(p_company uuid default null,p_search text default '',p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare all_companies boolean:=private.platform_permission('users.manage'); total bigint; rows jsonb;
begin
  if not all_companies and not exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and private.company_permission(m.company_id,'users.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_company is not null and not all_companies and not private.company_permission(p_company,'users.manage') then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page<1 or p_page>100000 or p_limit is null or p_limit<1 or p_limit>500 or length(coalesce(p_search,''))>120 then raise exception 'INVALID_REQUEST'; end if;
  select count(*) into total from public.clients c join auth.users u on u.id=c.user_id
    where c.is_seed=private.demo_mode() and (p_company is null or c.company_id=p_company)
      and (all_companies or private.company_permission(c.company_id,'users.manage'))
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(c.name||' '||u.email))>0);
  select coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) into rows from (
    select c.id,c.company_id,c.user_id,c.name,u.email,c.created_at,co.name as company_name,m.active,
      case when m.active and not p.suspended then 'active' else 'suspended' end as status,
      coalesce((select jsonb_agg(n.number order by n.number) from public.did_allocations a join public.did_numbers n on n.id=a.did_id
        where a.company_id=c.company_id and a.user_id=c.user_id and a.valid_to is null),'[]'::jsonb) as numbers
    from public.clients c join auth.users u on u.id=c.user_id join public.profiles p on p.id=c.user_id
      join public.companies co on co.id=c.company_id join public.company_memberships m on m.company_id=c.company_id and m.user_id=c.user_id
    where c.is_seed=private.demo_mode() and (p_company is null or c.company_id=p_company)
      and (all_companies or private.company_permission(c.company_id,'users.manage'))
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(c.name||' '||u.email))>0)
    order by c.created_at,c.id limit p_limit offset (p_page-1)*p_limit
  ) result;
  return jsonb_build_object('rows',rows,'total',total);
end $$;
revoke all on function public.list_clients(uuid,text,integer,integer) from public,anon;
grant execute on function public.list_clients(uuid,text,integer,integer) to authenticated,service_role;

create function public.update_client(p_client uuid,p_name text,p_active boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare client public.clients;
begin
  select * into client from public.clients where id=p_client for update;
  if not found or client.is_seed<>private.demo_mode() then raise exception 'NOT_FOUND'; end if;
  if not private.platform_permission('users.manage') and not private.company_permission(client.company_id,'users.manage') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 160 or p_active is null then raise exception 'INVALID_REQUEST'; end if;
  update public.clients set name=btrim(p_name) where id=p_client;
  update public.profiles set full_name=btrim(p_name) where id=client.user_id;
  update public.company_memberships set active=p_active where company_id=client.company_id and user_id=client.user_id and role='client';
  if not p_active then update public.caller_id_permissions set enabled=false where user_id=client.user_id; end if;
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(client.company_id,auth.uid(),'client.updated',p_client,jsonb_build_object('name',btrim(p_name),'active',p_active));
  return p_client;
end $$;
revoke all on function public.update_client(uuid,text,boolean) from public,anon;
grant execute on function public.update_client(uuid,text,boolean) to authenticated,service_role;

create or replace function public.my_context() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',p.id,'full_name',p.full_name,'platform_role',p.platform_role,'suspended',p.suspended,
 'membership',(select to_jsonb(m) from public.company_memberships m where m.user_id=p.id and m.active),
 'client',(select jsonb_build_object('id',c.id,'name',c.name,'company_id',c.company_id,'company_name',co.name)
   from public.clients c join public.companies co on co.id=c.company_id where c.user_id=p.id),
 'permissions',case when p.platform_role='super_admin' then (select jsonb_agg(key) from public.permissions) when p.platform_role='platform_admin' then
 (select coalesce(jsonb_agg(permission),'[]') from public.user_permissions where user_id=p.id and granted) else
 (select coalesce(jsonb_agg(distinct permission),'[]') from (
 select r.permission from public.company_memberships m join public.role_permissions r on r.role=m.role where m.user_id=p.id and m.active
 union select u.permission from public.user_permissions u where u.user_id=p.id and u.granted) allowed
 where not exists(select 1 from public.user_permissions u where u.user_id=p.id and u.permission=allowed.permission and not u.granted)) end)
 from public.profiles p where p.id=auth.uid() and not p.suspended
$$;
