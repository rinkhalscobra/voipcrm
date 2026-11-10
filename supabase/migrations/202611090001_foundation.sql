create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.companies (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 2 and 160),
  slug text unique not null, contact_name text, contact_email text, country text,
  currency text not null check (currency ~ '^[A-Z]{3}$'), status text not null default 'trial' check (status in ('active','trial','suspended','closed')),
  billing_address jsonb not null default '{}', tax_id text, billing_mode text not null default 'prepaid' check (billing_mode in ('prepaid','invoiced')),
  allowed_country_prefixes text[] not null default '{}', brand jsonb not null default '{}', is_seed boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, full_name text not null default '',
  platform_role text check (platform_role in ('super_admin','platform_admin')), suspended boolean not null default false,
  local_status text not null default 'offline', created_at timestamptz not null default now()
);
create table public.platform_roles (name text primary key);
insert into public.platform_roles values ('super_admin'),('platform_admin'),('company_admin'),('manager'),('team_leader'),('agent');
create table public.permissions (key text primary key, description text not null);
insert into public.permissions values
 ('companies.manage','Manage companies'),('providers.manage','Manage upstream credentials and synchronization'),
 ('numbers.manage','Manage allocations'),('calls.read','Read authorized calls'),('calls.initiate','Initiate authorized callbacks'),
 ('users.manage','Invite and manage users'),('teams.manage','Manage departments and teams'),('finance.read','Read finance'),
 ('finance.write','Adjust wallets and invoices'),('reports.export','Export authorized reports'),('audit.read','Read audit history'),
 ('settings.manage','Manage platform settings'),('pricing.manage','Version pricing plans');
create table public.role_permissions (role text references public.platform_roles(name), permission text references public.permissions(key), primary key(role,permission));
insert into public.role_permissions select 'super_admin', key from public.permissions;
insert into public.role_permissions select 'company_admin', key from public.permissions where key in ('calls.read','calls.initiate','users.manage','teams.manage','finance.read','reports.export');
insert into public.role_permissions select r, p from unnest(array['manager','team_leader','agent']) r cross join unnest(array['calls.read','calls.initiate']) p;
create table public.user_permissions (user_id uuid references public.profiles(id), permission text references public.permissions(key), granted boolean not null, primary key(user_id,permission));
create table public.company_departments (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text not null, manager_id uuid references public.profiles(id), unique(company_id,id), unique(company_id,name));
create table public.teams (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), department_id uuid, name text not null, leader_id uuid references public.profiles(id), foreign key(company_id,department_id) references public.company_departments(company_id,id), unique(company_id,id), unique(company_id,name));
create table public.company_memberships (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), user_id uuid not null references public.profiles(id),
 role text not null check(role in ('company_admin','manager','team_leader','agent')), department_id uuid, team_id uuid,
 manager_id uuid references public.profiles(id), team_leader_id uuid references public.profiles(id), active boolean not null default true,
 foreign key(company_id,department_id) references public.company_departments(company_id,id), foreign key(company_id,team_id) references public.teams(company_id,id),
 unique(company_id,user_id), unique(user_id)
);
create table public.team_memberships (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), team_id uuid not null, user_id uuid not null references public.profiles(id), valid_from timestamptz not null default now(), valid_to timestamptz, foreign key(company_id,team_id) references public.teams(company_id,id), check(valid_to is null or valid_to > valid_from));
create table public.user_invitations (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), email text not null, role text not null check(role in ('company_admin','manager','team_leader','agent')), invited_by uuid references public.profiles(id), auth_user_id uuid references auth.users(id), accepted_at timestamptz, expires_at timestamptz not null default now()+interval '7 days', created_at timestamptz not null default now());

create function private.active_user() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.profiles where id=auth.uid() and not suspended) $$;
create function private.platform_permission(p text) returns boolean language sql stable security definer set search_path = '' as $$
 select private.active_user() and coalesce(auth.jwt()->>'aal','')='aal2' and exists(
 select 1 from public.profiles x where x.id=auth.uid() and (x.platform_role='super_admin' or (x.platform_role='platform_admin' and exists(select 1 from public.user_permissions u where u.user_id=x.id and u.permission=p and u.granted))))
$$;
create function private.company_access(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select private.active_user() and exists(select 1 from public.company_memberships m join public.companies x on x.id=m.company_id where m.user_id=auth.uid() and m.company_id=c and m.active and x.status in ('active','trial'))
$$;
create function private.company_permission(c uuid,p text) returns boolean language sql stable security definer set search_path = '' as $$
 select private.company_access(c) and exists(select 1 from public.company_memberships m join public.role_permissions r on r.role=m.role and r.permission=p where m.user_id=auth.uid() and m.company_id=c)
 and not exists(select 1 from public.user_permissions u where u.user_id=auth.uid() and u.permission=p and not u.granted)
$$;
create function private.scope_access(c uuid,u uuid,mgr uuid,leader uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select private.platform_permission('calls.read') or (private.company_access(c) and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.company_id=c and (m.role='company_admin' or u=auth.uid() or (m.role='manager' and mgr=auth.uid()) or (m.role='team_leader' and leader=auth.uid()))))
$$;
create function public.my_context() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',p.id,'full_name',p.full_name,'platform_role',p.platform_role,'suspended',p.suspended,
 'membership',(select to_jsonb(m) from public.company_memberships m where m.user_id=p.id and m.active),
 'permissions',case when p.platform_role='super_admin' then (select jsonb_agg(key) from public.permissions) when p.platform_role='platform_admin' then (select coalesce(jsonb_agg(permission),'[]') from public.user_permissions where user_id=p.id and granted) else
 (select coalesce(jsonb_agg(r.permission),'[]') from public.company_memberships m join public.role_permissions r on r.role=m.role where m.user_id=p.id and m.active and not exists(select 1 from public.user_permissions u where u.user_id=p.id and u.permission=r.permission and not u.granted)) end)
 from public.profiles p where p.id=auth.uid() and not p.suspended
$$;

create table public.provider_accounts (
 id uuid primary key default gen_random_uuid(), name text not null, currency text not null check(currency ~ '^[A-Z]{3}$'),
 status text not null default 'pending_verification' check(status in ('pending_verification','active','disabled','error')),
 balance numeric(20,6), credit numeric(20,6), credit_limit numeric(20,6), balance_updated_at timestamptz,
 last_successful_sync timestamptz, last_error_code text, verified_resources text[] not null default '{}',
 created_at timestamptz not null default now(), is_seed boolean not null default false
);
create table private.provider_credentials (provider_account_id uuid primary key references public.provider_accounts(id), ciphertext text not null, updated_at timestamptz not null default now());
create table public.provider_api_syncs (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), resource text not null, status text not null, records integer not null default 0, error_code text, started_at timestamptz not null default now(), finished_at timestamptz);
create table public.provider_api_errors (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), code text not null, created_at timestamptz not null default now());
create table public.provider_users (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), provider_resource_id text not null, name text, application_user_id uuid references public.profiles(id), raw jsonb not null default '{}', synced_at timestamptz not null default now(), unique(provider_account_id,provider_resource_id));
create table public.provider_devices (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), provider_resource_id text not null, provider_user_resource_id text, application_user_id uuid references public.profiles(id), raw jsonb not null default '{}', synced_at timestamptz not null default now(), unique(provider_account_id,provider_resource_id));
create table public.provider_caller_id_groups (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), provider_resource_id text not null, provider_user_id uuid references public.provider_users(id), raw jsonb not null default '{}', unique(provider_account_id,provider_user_id,provider_resource_id));
create table public.provider_user_statuses (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), provider_resource_id text not null, name text not null, enabled boolean not null default true, is_offline boolean not null default false, raw jsonb not null default '{}', unique(provider_account_id,provider_resource_id));

create table public.did_numbers (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), provider_resource_id text not null, number text not null, country text, provider_status text, wholesale_monthly numeric(20,6), renewal_at text, synced_at timestamptz not null default now(), raw jsonb not null default '{}', unique(provider_account_id,provider_resource_id));
create table public.did_allocations (id uuid primary key default gen_random_uuid(), did_id uuid not null references public.did_numbers(id), company_id uuid not null references public.companies(id), user_id uuid references public.profiles(id), manager_id uuid references public.profiles(id), team_leader_id uuid references public.profiles(id), monthly_price numeric(20,6) not null default 0 check(monthly_price>=0), valid_from timestamptz not null default now(), valid_to timestamptz, check(valid_to is null or valid_to>=valid_from));
create unique index one_active_allocation on public.did_allocations(did_id) where valid_to is null;
create index allocation_history on public.did_allocations(did_id,valid_from,valid_to);
create table public.did_user_assignments (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), allocation_id uuid not null references public.did_allocations(id), user_id uuid not null references public.profiles(id), valid_from timestamptz not null default now(), valid_to timestamptz);
create table public.did_orders (id uuid primary key default gen_random_uuid(), provider_account_id uuid references public.provider_accounts(id), company_id uuid references public.companies(id), provider_resource_id text, status text not null default 'draft', country text, quantity integer not null check(quantity between 1 and 100), raw jsonb not null default '{}', created_at timestamptz not null default now(), unique(provider_account_id,provider_resource_id));
create table public.did_order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.did_orders(id), company_id uuid references public.companies(id), did_id uuid references public.did_numbers(id));
create table public.calls (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), provider_resource_id text not null, company_id uuid references public.companies(id), user_id uuid references public.profiles(id), manager_id uuid references public.profiles(id), team_leader_id uuid references public.profiles(id), allocation_id uuid references public.did_allocations(id), origin text, destination text, started_at timestamptz not null, ended_at timestamptz, duration_seconds integer check(duration_seconds>=0), direction text, status text, provider_cost numeric(20,6), customer_charge numeric(20,6), currency text, billing_status text not null default 'review', synced_at timestamptz not null default now(), unique(provider_account_id,provider_resource_id));
create index calls_company_time on public.calls(company_id,started_at desc);
create index calls_user_time on public.calls(user_id,started_at desc);
create index calls_provider_time on public.calls(provider_account_id,started_at desc);
create table private.call_payloads (call_id uuid primary key references public.calls(id), raw jsonb not null);
create table public.call_events (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), call_id uuid not null references public.calls(id), type text not null, occurred_at timestamptz not null default now(), data jsonb not null default '{}');
create table public.call_recordings_metadata (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), company_id uuid references public.companies(id), call_id uuid not null references public.calls(id), provider_reference text not null, retained_until timestamptz);
create table public.caller_id_permissions (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), user_id uuid not null references public.profiles(id), device_id uuid not null references public.provider_devices(id), allocation_id uuid not null references public.did_allocations(id), enabled boolean not null default false, verified_at timestamptz, unique(user_id,device_id,allocation_id));
create table public.hlr_lookups (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), company_id uuid references public.companies(id), user_id uuid references public.profiles(id), number text not null, result jsonb not null, created_at timestamptz not null default now());
create table public.favorite_contacts (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), user_id uuid not null references public.profiles(id), name text not null, number text not null check(number ~ '^\+[1-9][0-9]{6,14}$'));

create table public.customer_wallets (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), currency text not null check(currency ~ '^[A-Z]{3}$'), balance numeric(20,6) not null default 0 check(balance>=0), minimum_balance numeric(20,6) not null default 0, suspended boolean not null default false, unique(company_id,currency));
create table public.wallet_transactions (id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.customer_wallets(id), company_id uuid not null references public.companies(id), currency text not null, type text not null check(type in ('credit','debit','refund','adjustment','call_charge','reversal')), amount numeric(20,6) not null check(amount<>0), balance_after numeric(20,6) not null, idempotency_key text not null unique, related_id uuid, reason text not null, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.pricing_plans (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), name text not null, currency text not null check(currency ~ '^[A-Z]{3}$'), created_at timestamptz not null default now());
create table public.pricing_plan_versions (id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.pricing_plans(id), version integer not null, valid_from timestamptz not null default now(), rules jsonb not null, unique(plan_id,version));
create table public.destination_rates (id uuid primary key default gen_random_uuid(), version_id uuid not null references public.pricing_plan_versions(id), prefix text not null check(prefix ~ '^[1-9][0-9]*$'), per_minute numeric(20,6) not null check(per_minute>=0), connection_fee numeric(20,6) not null default 0 check(connection_fee>=0), minimum_seconds integer not null default 0 check(minimum_seconds>=0), increment_seconds integer not null default 1 check(increment_seconds>0), unique(version_id,prefix));
create table public.number_prices (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), did_id uuid not null references public.did_numbers(id), setup_fee numeric(20,6) not null default 0, monthly_fee numeric(20,6) not null, currency text not null);
create table public.call_charges (id uuid primary key default gen_random_uuid(), call_id uuid not null unique references public.calls(id), company_id uuid not null references public.companies(id), version_id uuid not null references public.pricing_plan_versions(id), currency text not null, amount numeric(20,6) not null check(amount>=0), pricing_snapshot jsonb not null, created_at timestamptz not null default now());
create table public.customer_subscriptions (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), plan_id uuid not null references public.pricing_plans(id), starts_at timestamptz not null default now(), ends_at timestamptz, status text not null default 'active');
create table public.invoices (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), number text not null unique, currency text not null, status text not null default 'draft' check(status in ('draft','issued','paid','void')), period_start date not null, period_end date not null, subtotal numeric(20,6) not null default 0, tax numeric(20,6) not null default 0, total numeric(20,6) not null default 0, due_at date, created_at timestamptz not null default now(), check(period_end>=period_start));
create table public.invoice_items (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), invoice_id uuid not null references public.invoices(id), description text not null, quantity numeric(20,6) not null check(quantity>0), unit_price numeric(20,6) not null check(unit_price>=0), tax_percent numeric(10,6) not null default 0 check(tax_percent between 0 and 100), charge_id uuid unique references public.call_charges(id));
create table public.payments (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), invoice_id uuid not null references public.invoices(id), amount numeric(20,6) not null check(amount>0), currency text not null, reference text not null unique, recorded_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.billing_adjustments (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), transaction_id uuid not null references public.wallet_transactions(id), original_transaction_id uuid not null references public.wallet_transactions(id), reason text not null);
create table public.billing_exceptions (id uuid primary key default gen_random_uuid(), provider_account_id uuid references public.provider_accounts(id), company_id uuid references public.companies(id), call_id uuid references public.calls(id), code text not null, status text not null default 'open', created_at timestamptz not null default now(), unique(call_id,code));

create table public.audit_logs (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), actor_id uuid references public.profiles(id), action text not null, resource_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table public.login_history (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), event text not null, created_at timestamptz not null default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), user_id uuid references public.profiles(id), title text not null, message text not null, severity text not null default 'info', read_at timestamptz, created_at timestamptz not null default now());
create table public.notification_rules (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), provider_account_id uuid references public.provider_accounts(id), type text not null, threshold numeric(20,6), enabled boolean not null default true);
create table public.system_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table public.sync_jobs (id uuid primary key default gen_random_uuid(), provider_account_id uuid not null references public.provider_accounts(id), resource text not null check(resource in ('balance','users','devices','dids','calls','statuses')), status text not null default 'pending' check(status in ('pending','running','completed','failed')), attempts integer not null default 0, run_after timestamptz not null default now(), locked_until timestamptz, lease_token uuid, last_error_code text, created_at timestamptz not null default now());
create unique index one_pending_sync on public.sync_jobs(provider_account_id,resource) where status in ('pending','running');
create index queue_ready on public.sync_jobs(status,run_after);
create table public.integration_events (id uuid primary key default gen_random_uuid(), provider_account_id uuid references public.provider_accounts(id), company_id uuid references public.companies(id), type text not null, status text not null default 'pending', metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table public.idempotency_records (key text primary key, user_id uuid not null references public.profiles(id), company_id uuid references public.companies(id), request_hash text not null, status text not null default 'pending', result jsonb, created_at timestamptz not null default now());
create table private.rate_limit_buckets (key text primary key, window_start timestamptz not null, count integer not null);

-- No client may change role, ownership, call snapshots, credentials, or financial records directly.
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='public' loop
 execute format('alter table public.%I enable row level security',t.tablename);
 execute format('revoke all on public.%I from anon, authenticated',t.tablename);
 execute format('grant all on public.%I to service_role',t.tablename);
 end loop; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
grant execute on all functions in schema private to authenticated,service_role;
grant usage on schema private to authenticated;

grant select on public.companies,public.company_memberships,public.company_departments,public.teams,public.team_memberships,public.user_invitations,public.customer_wallets,public.wallet_transactions,public.invoices,public.invoice_items,public.payments,public.notifications,public.audit_logs,public.login_history,public.favorite_contacts to authenticated;
grant select(id,full_name,local_status) on public.profiles to authenticated;
grant select(id,company_id,user_id,manager_id,team_leader_id,origin,destination,started_at,ended_at,duration_seconds,direction,status,customer_charge,currency,billing_status,synced_at) on public.calls to authenticated;
grant select on public.did_allocations to authenticated;
-- did_numbers contains wholesale/provider fields: clients access only through a sanitized RPC below.
create policy companies_read on public.companies for select using(private.company_access(id) or private.platform_permission('companies.manage'));
create policy members_read on public.company_memberships for select using(private.scope_access(company_id,user_id,manager_id,team_leader_id) or private.platform_permission('users.manage'));
create policy profiles_read on public.profiles for select using(id=auth.uid() or private.platform_permission('users.manage') or exists(select 1 from public.company_memberships m where m.user_id=profiles.id and private.scope_access(m.company_id,m.user_id,m.manager_id,m.team_leader_id)));
create policy departments_read on public.company_departments for select using(private.platform_permission('teams.manage') or (private.company_access(company_id) and (manager_id=auth.uid() or private.company_permission(company_id,'teams.manage'))));
create policy teams_read on public.teams for select using(private.platform_permission('teams.manage') or (private.company_access(company_id) and (leader_id=auth.uid() or private.company_permission(company_id,'teams.manage') or exists(select 1 from public.company_departments d where d.id=teams.department_id and d.manager_id=auth.uid()))));
create policy team_members_read on public.team_memberships for select using(private.platform_permission('teams.manage') or user_id=auth.uid() or private.company_permission(company_id,'teams.manage'));
create policy invitations_read on public.user_invitations for select using(private.platform_permission('users.manage') or private.company_permission(company_id,'users.manage'));
create policy calls_read on public.calls for select using(private.scope_access(company_id,user_id,manager_id,team_leader_id));
create policy allocations_read on public.did_allocations for select using(private.platform_permission('numbers.manage') or private.scope_access(company_id,user_id,manager_id,team_leader_id));
do $$ declare t text; begin foreach t in array array['customer_wallets','wallet_transactions','invoices','invoice_items','payments'] loop
 execute format('create policy finance_read on public.%I for select using(private.platform_permission(''finance.read'') or private.company_permission(company_id,''finance.read''))',t);
 end loop; end $$;
create policy notifications_read on public.notifications for select using(private.platform_permission('audit.read') or (private.active_user() and user_id=auth.uid()) or (user_id is null and private.company_permission(company_id,'users.manage')));
create policy audit_read on public.audit_logs for select using(private.platform_permission('audit.read') or private.company_permission(company_id,'users.manage'));
create policy login_read on public.login_history for select using(user_id=auth.uid() or private.platform_permission('audit.read'));
create policy favorites_read on public.favorite_contacts for select using(user_id=auth.uid() and private.company_access(company_id));

create function public.my_numbers() returns table(id uuid,number text,country text,company_id uuid,user_id uuid,status text,monthly_price numeric,synced_at timestamptz) language sql stable security definer set search_path = '' as $$
 select n.id,n.number,n.country,a.company_id,a.user_id,n.provider_status,a.monthly_price,n.synced_at
 from public.did_numbers n join public.did_allocations a on a.did_id=n.id and a.valid_to is null
 where private.scope_access(a.company_id,a.user_id,a.manager_id,a.team_leader_id)
$$;
create function public.set_provider_secret(p_id uuid,p_ciphertext text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not private.platform_permission('providers.manage') then raise exception 'FORBIDDEN'; end if;
 insert into private.provider_credentials values(p_id,p_ciphertext,now()) on conflict(provider_account_id) do update set ciphertext=excluded.ciphertext,updated_at=now();
 insert into public.audit_logs(actor_id,action,resource_id) values(auth.uid(),'provider.credentials_replaced',p_id);
end $$;
create function public.worker_provider_secret(p_id uuid) returns text language sql security definer set search_path = '' as $$ select ciphertext from private.provider_credentials where provider_account_id=p_id and auth.role()='service_role' $$;

create function public.allocate_did(p_did uuid,p_company uuid,p_user uuid,p_price numeric) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_m public.company_memberships;
begin
 if not private.platform_permission('numbers.manage') then raise exception 'FORBIDDEN'; end if;
 if p_price<0 or p_price<>round(p_price,6) then raise exception 'INVALID_PRICE'; end if;
 perform 1 from public.did_numbers where id=p_did for update; if not found then raise exception 'NOT_FOUND'; end if;
 perform 1 from public.companies where id=p_company and status in ('active','trial'); if not found then raise exception 'COMPANY_INACTIVE'; end if;
 if exists(select 1 from public.did_allocations where did_id=p_did and valid_to is null) then raise exception 'ALLOCATION_CONFLICT'; end if;
 if p_user is not null then select * into v_m from public.company_memberships where company_id=p_company and user_id=p_user and active; if not found then raise exception 'INVALID_MEMBER'; end if; end if;
 insert into public.did_allocations(did_id,company_id,user_id,manager_id,team_leader_id,monthly_price) values(p_did,p_company,p_user,v_m.manager_id,v_m.team_leader_id,p_price) returning id into v_id;
 insert into public.audit_logs(company_id,actor_id,action,resource_id) values(p_company,auth.uid(),'number.allocated',p_did);
 return v_id;
end $$;
create function public.unallocate_did(p_did uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
 if not private.platform_permission('numbers.manage') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.did_numbers where id=p_did for update;
 update public.did_allocations set valid_to=now() where did_id=p_did and valid_to is null returning company_id into c;
 if not found then raise exception 'NOT_FOUND'; end if;
 update public.caller_id_permissions set enabled=false where allocation_id in(select id from public.did_allocations where did_id=p_did);
 insert into public.audit_logs(company_id,actor_id,action,resource_id) values(c,auth.uid(),'number.unallocated',p_did);
end $$;

-- Immutable ledger; same key with different intent is rejected, even across wallets.
create function private.immutable_record() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'IMMUTABLE_RECORD'; end $$;
create trigger ledger_immutable before update or delete on public.wallet_transactions for each row execute function private.immutable_record();
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function private.immutable_record();
create trigger version_immutable before update or delete on public.pricing_plan_versions for each row execute function private.immutable_record();
create trigger charge_immutable before update or delete on public.call_charges for each row execute function private.immutable_record();
create function public.wallet_post(p_wallet uuid,p_amount numeric,p_type text,p_key text,p_reason text,p_related uuid default null) returns public.wallet_transactions language plpgsql security definer set search_path = '' as $$
declare w public.customer_wallets; tx public.wallet_transactions;
begin
 if not private.platform_permission('finance.write') and auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_amount=0 or p_amount<>round(p_amount,6) or length(p_reason)<3 or length(p_key)<8 or p_type not in ('credit','debit','refund','adjustment','call_charge','reversal') then raise exception 'INVALID_TRANSACTION'; end if;
 if (p_type in ('credit','refund') and p_amount<0) or (p_type in ('debit','call_charge') and p_amount>0) then raise exception 'INVALID_TRANSACTION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,0));
 select * into tx from public.wallet_transactions where idempotency_key=p_key;
 if found then if tx.wallet_id<>p_wallet or tx.amount<>p_amount or tx.type<>p_type or tx.reason<>p_reason or tx.related_id is distinct from p_related then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return tx; end if;
 select * into w from public.customer_wallets where id=p_wallet for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if w.suspended then raise exception 'WALLET_SUSPENDED'; end if;
 if w.balance+p_amount<0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
 update public.customer_wallets set balance=balance+p_amount where id=p_wallet returning * into w;
 insert into public.wallet_transactions(wallet_id,company_id,currency,type,amount,balance_after,idempotency_key,related_id,reason,created_by)
 values(w.id,w.company_id,w.currency,p_type,p_amount,w.balance,p_key,p_related,p_reason,auth.uid()) returning * into tx;
 insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata) values(w.company_id,auth.uid(),'wallet.'||p_type,tx.id,jsonb_build_object('amount',p_amount,'currency',w.currency));
 return tx;
end $$;

create function public.claim_sync_job() returns setof public.sync_jobs language plpgsql security definer set search_path = '' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 return query with job as (select j.id from public.sync_jobs j join public.provider_accounts p on p.id=j.provider_account_id where p.status<>'disabled' and ((j.status='pending' and j.run_after<=now()) or (j.status='running' and j.locked_until<now())) order by j.run_after for update of j skip locked limit 1)
 update public.sync_jobs j set status='running',attempts=attempts+1,locked_until=now()+interval '90 seconds',lease_token=gen_random_uuid() from job where j.id=job.id returning j.*;
end $$;
create function public.consume_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 insert into private.rate_limit_buckets values(p_key,now(),1) on conflict(key) do update set count=case when private.rate_limit_buckets.window_start<now()-make_interval(secs=>p_seconds) then 1 else private.rate_limit_buckets.count+1 end, window_start=case when private.rate_limit_buckets.window_start<now()-make_interval(secs=>p_seconds) then now() else private.rate_limit_buckets.window_start end returning count into n;
 return n<=p_limit;
end $$;

-- Import resolves ownership at the call's timestamp. Destination-only outbound matching is forbidden.
create function public.import_call(p_provider uuid,p_call text,p_origin text,p_destination text,p_start timestamptz,p_end timestamptz,p_duration integer,p_direction text,p_status text,p_cost numeric,p_raw jsonb,p_identity text) returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.did_allocations; v_id uuid; v_count integer; v_currency text;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 select count(*) into v_count from public.did_allocations x join public.did_numbers n on n.id=x.did_id where n.provider_account_id=p_provider and regexp_replace(n.number,'[^0-9]','','g')=regexp_replace(p_identity,'[^0-9]','','g') and x.valid_from<=p_start and (x.valid_to is null or x.valid_to>p_start);
 if v_count=1 then select x.* into a from public.did_allocations x join public.did_numbers n on n.id=x.did_id where n.provider_account_id=p_provider and regexp_replace(n.number,'[^0-9]','','g')=regexp_replace(p_identity,'[^0-9]','','g') and x.valid_from<=p_start and (x.valid_to is null or x.valid_to>p_start); end if;
 select currency into v_currency from public.provider_accounts where id=p_provider;
 insert into public.calls(provider_account_id,provider_resource_id,company_id,user_id,manager_id,team_leader_id,allocation_id,origin,destination,started_at,ended_at,duration_seconds,direction,status,provider_cost,currency)
 values(p_provider,p_call,a.company_id,a.user_id,a.manager_id,a.team_leader_id,a.id,p_origin,p_destination,p_start,p_end,p_duration,p_direction,p_status,p_cost,v_currency)
 on conflict(provider_account_id,provider_resource_id) do update set ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,status=excluded.status,provider_cost=excluded.provider_cost,synced_at=now() returning id into v_id;
 insert into private.call_payloads values(v_id,p_raw) on conflict(call_id) do update set raw=excluded.raw;
 if a.id is null then insert into public.billing_exceptions(provider_account_id,call_id,code) values(p_provider,v_id,'UNRESOLVED_OWNERSHIP') on conflict(call_id,code) do nothing; end if;
 return v_id;
end $$;

create function public.rate_call(p_call uuid,p_version uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.calls; v public.pricing_plan_versions; plan public.pricing_plans; r public.destination_rates; amount numeric; seconds integer; charge uuid; w uuid;
begin
 if not private.platform_permission('finance.write') then raise exception 'FORBIDDEN'; end if;
 select * into c from public.calls where id=p_call for update;
 if not found or c.company_id is null or c.ended_at is null or c.duration_seconds is null then raise exception 'CALL_NOT_FINAL'; end if;
 select id into charge from public.call_charges where call_id=p_call; if found then return charge; end if;
 select * into v from public.pricing_plan_versions where id=p_version;
 select * into plan from public.pricing_plans where id=v.plan_id;
 if plan.id is null or plan.company_id is distinct from c.company_id or v.valid_from>c.started_at then raise exception 'INVALID_PLAN'; end if;
 select * into r from public.destination_rates where version_id=p_version and replace(c.destination,'+','') like prefix||'%' order by length(prefix) desc limit 1;
 if not found then raise exception 'NO_DESTINATION_RATE'; end if;
 if c.status<>'answer' then raise exception 'CALL_STATUS_REQUIRES_REVIEW'; end if;
 seconds:=ceil(greatest(c.duration_seconds,r.minimum_seconds)::numeric/r.increment_seconds)::integer*r.increment_seconds;
 amount:=round(r.connection_fee+seconds::numeric*r.per_minute/60,6);
 insert into public.call_charges(call_id,company_id,version_id,currency,amount,pricing_snapshot) values(c.id,c.company_id,v.id,plan.currency,amount,to_jsonb(r)) returning id into charge;
 if (select billing_mode from public.companies where id=c.company_id)='prepaid' and amount>0 then
 select id into w from public.customer_wallets where company_id=c.company_id and currency=plan.currency;
 if w is null then raise exception 'WALLET_MISSING'; end if;
 perform public.wallet_post(w,-amount,'call_charge','call:'||c.id::text,'Rated call',charge);
 end if;
 update public.calls set customer_charge=amount,billing_status='charged',currency=plan.currency where id=c.id;
 insert into public.audit_logs(company_id,actor_id,action,resource_id) values(c.company_id,auth.uid(),'call.finalized_and_rated',c.id);
 return charge;
end $$;

-- Remove PostgreSQL's default PUBLIC function execution grants.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_context(),public.my_numbers(),public.set_provider_secret(uuid,text),public.allocate_did(uuid,uuid,uuid,numeric),public.unallocate_did(uuid),public.wallet_post(uuid,numeric,text,text,text,uuid),public.rate_call(uuid,uuid) to authenticated;
grant execute on all functions in schema public to service_role;
revoke execute on all functions in schema private from public,anon;
grant execute on all functions in schema private to authenticated,service_role;
