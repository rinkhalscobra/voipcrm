-- Retail client credit is independent of company wallets and TelTel funds.
create table public.client_wallets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id),
  company_id uuid not null references public.companies(id),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  balance numeric(20,6) not null default 0 check(balance>=0 and balance<>'NaN'::numeric),
  billing_from timestamptz not null default clock_timestamp(),
  suspended boolean not null default false,
  updated_at timestamptz not null default now(),
  is_seed boolean not null default false
);
create table public.client_rates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  company_id uuid not null references public.companies(id),
  country_name text not null default 'Germany',
  prefix text not null default '49' check(prefix ~ '^[1-9][0-9]*$'),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  per_minute numeric(12,6) not null check(per_minute>=0 and per_minute<>'NaN'::numeric),
  increment_seconds integer not null default 1 check(increment_seconds>0),
  valid_from timestamptz not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  is_seed boolean not null default false
);
create index client_rate_history on public.client_rates(client_id,prefix,valid_from desc);
create table public.client_call_ratings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  company_id uuid not null references public.companies(id),
  call_id uuid not null references public.calls(id),
  rate_id uuid references public.client_rates(id),
  revision integer not null check(revision>0),
  source_signature text not null,
  talk_seconds integer not null check(talk_seconds>=0),
  billable_seconds bigint not null check(billable_seconds>=0),
  amount numeric(20,6) check(amount>=0 and amount<>'NaN'::numeric),
  currency text not null,
  reason text not null,
  rate_snapshot jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  is_seed boolean not null default false,
  unique(call_id,revision)
);
create index client_rating_latest on public.client_call_ratings(call_id,revision desc);
create table public.client_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.client_wallets(id),
  client_id uuid not null references public.clients(id),
  company_id uuid not null references public.companies(id),
  currency text not null,
  type text not null check(type in ('credit','debit','adjustment','call_charge','call_refund')),
  amount numeric(20,6) not null check(amount<>0 and amount<>'NaN'::numeric),
  balance_after numeric(20,6) not null check(balance_after>=0 and balance_after<>'NaN'::numeric),
  reference_key text not null unique,
  rating_id uuid references public.client_call_ratings(id),
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  is_seed boolean not null default false
);
create index client_ledger_wallet on public.client_wallet_entries(wallet_id,created_at desc);
create table public.client_balance_operations (
  id uuid primary key default gen_random_uuid(),
  reference_key text not null unique,
  wallet_id uuid not null references public.client_wallets(id),
  client_id uuid not null references public.clients(id),
  company_id uuid not null references public.companies(id),
  type text not null check(type in ('set','credit','debit')),
  amount numeric(20,6) not null,
  reason text not null,
  balance_after numeric(20,6) not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  is_seed boolean not null default false
);

do $$ declare t text; begin
  foreach t in array array['client_wallets','client_rates','client_call_ratings','client_wallet_entries','client_balance_operations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy client_finance_read on public.%I for select using(private.platform_permission(''finance.read'') or private.company_permission(company_id,''finance.read'') or exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid() and private.company_access(c.company_id)))',t);
    execute format('create trigger inherit_data_mode before insert or update on public.%I for each row execute function private.inherit_data_mode()',t);
  end loop;
  foreach t in array array['client_rates','client_call_ratings','client_wallet_entries','client_balance_operations'] loop
    execute format('create trigger client_finance_immutable before update or delete on public.%I for each row execute function private.immutable_record()',t);
  end loop;
end $$;

create function private.initialize_client_wallet() returns trigger language plpgsql security definer set search_path = '' as $$
declare wallet public.client_wallets; client_currency text;
begin
  select currency into client_currency from public.companies where id=new.company_id;
  insert into public.client_wallets(client_id,company_id,currency) values(new.id,new.company_id,client_currency) returning * into wallet;
  if client_currency='EUR' then
    insert into public.client_rates(client_id,company_id,currency,per_minute,valid_from)
      values(new.id,new.company_id,client_currency,0.0442,wallet.billing_from);
  end if;
  return new;
end $$;
revoke all on function private.initialize_client_wallet() from public,anon,authenticated;
create trigger initialize_client_wallet after insert on public.clients for each row execute function private.initialize_client_wallet();
insert into public.client_wallets(client_id,company_id,currency)
  select c.id,c.company_id,co.currency from public.clients c join public.companies co on co.id=c.company_id;
insert into public.client_rates(client_id,company_id,currency,per_minute,valid_from)
  select client_id,company_id,currency,0.0442,billing_from from public.client_wallets where currency='EUR';

-- handle_sec is TelTel's actual talk time; waiting time is never charged.
alter table public.calls add column talk_seconds integer check(talk_seconds>=0);
grant select(talk_seconds) on public.calls to authenticated;
create function private.capture_call_talk_time() returns trigger language plpgsql security definer set search_path = '' as $$
declare seconds integer; supplied text:=new.raw->>'handle_sec';
begin
  if supplied is null then select duration_seconds into seconds from public.calls where id=new.call_id;
  elsif supplied ~ '^[0-9]+$' and length(supplied)<=10 then
    if supplied::numeric<=2147483647 then seconds:=supplied::integer; else seconds:=null; end if;
  else seconds:=null; end if;
  update public.calls set talk_seconds=seconds where id=new.call_id and talk_seconds is distinct from seconds;
  return new;
end $$;
revoke all on function private.capture_call_talk_time() from public,anon,authenticated;
create trigger capture_call_talk_time after insert or update of raw on private.call_payloads for each row execute function private.capture_call_talk_time();
update public.calls c set talk_seconds=case
  when p.raw->>'handle_sec' ~ '^[0-9]{1,10}$' then case when (p.raw->>'handle_sec')::numeric<=2147483647 then (p.raw->>'handle_sec')::integer else null end
  when p.raw->>'handle_sec' is null then c.duration_seconds else null end
  from private.call_payloads p where p.call_id=c.id and c.is_seed=private.demo_mode();
update public.calls c set billing_status='before_billing_start'
  from public.clients cl join public.client_wallets w on w.client_id=cl.id
  where c.user_id=cl.user_id and c.company_id=cl.company_id and c.started_at<w.billing_from and c.customer_charge is null and c.is_seed=private.demo_mode();

create function private.mark_client_billing_start() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_charge is null and exists(select 1 from public.clients cl join public.client_wallets w on w.client_id=cl.id
    where cl.user_id=new.user_id and cl.company_id=new.company_id and new.started_at<w.billing_from) then new.billing_status:='before_billing_start'; end if;
  return new;
end $$;
revoke all on function private.mark_client_billing_start() from public,anon,authenticated;
create trigger mark_client_billing_start before insert or update of user_id,company_id,started_at on public.calls
  for each row execute function private.mark_client_billing_start();

create function private.client_call_signature(c public.calls) returns text language sql immutable set search_path = '' as $$
  select md5(jsonb_build_object('user',c.user_id,'company',c.company_id,'talk',c.talk_seconds,'status',c.status,
    'end',c.ended_at,'direction',c.direction,'destination',c.destination,'currency',c.currency)::text)
$$;
revoke all on function private.client_call_signature(public.calls) from public,anon,authenticated;

create function private.client_credit_entry(p_wallet uuid,p_amount numeric,p_type text,p_key text,p_reason text,p_rating uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare wallet public.client_wallets; previous public.client_wallet_entries; entry_id uuid;
begin
  select * into wallet from public.client_wallets where id=p_wallet for update;
  if not found or wallet.is_seed<>private.demo_mode() then raise exception 'NOT_FOUND'; end if;
  select * into previous from public.client_wallet_entries where reference_key=p_key;
  if found then
    if previous.wallet_id<>p_wallet or previous.amount<>p_amount or previous.type<>p_type or previous.rating_id is distinct from p_rating then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return previous.id;
  end if;
  if p_amount is null or p_amount=0 or p_amount<>round(p_amount,6) or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'INVALID_TRANSACTION'; end if;
  if wallet.balance+p_amount<0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
  update public.client_wallets set balance=balance+p_amount,updated_at=clock_timestamp() where id=p_wallet returning * into wallet;
  insert into public.client_wallet_entries(wallet_id,client_id,company_id,currency,type,amount,balance_after,reference_key,rating_id,reason,created_by)
    values(wallet.id,wallet.client_id,wallet.company_id,wallet.currency,p_type,p_amount,wallet.balance,p_key,p_rating,p_reason,auth.uid()) returning id into entry_id;
  return entry_id;
end $$;
revoke all on function private.client_credit_entry(uuid,numeric,text,text,text,uuid) from public,anon,authenticated;

create function private.client_pending_usage(p_client uuid) returns numeric language sql stable security definer set search_path = '' as $$
 select coalesce(sum(greatest(latest.amount-coalesce(paid.amount,0),0)),0) from (
   select distinct on(call_id) * from public.client_call_ratings where client_id=p_client order by call_id,revision desc
 ) latest left join lateral (
   select -sum(e.amount) as amount from public.client_wallet_entries e join public.client_call_ratings r on r.id=e.rating_id
   where r.call_id=latest.call_id
 ) paid on true where latest.amount is not null
$$;
revoke all on function private.client_pending_usage(uuid) from public,anon,authenticated;

create function private.settle_client_credit(p_wallet uuid) returns void language plpgsql security definer set search_path = '' as $$
declare wallet public.client_wallets; rating record; paid numeric; difference numeric; deduction numeric;
begin
  select * into wallet from public.client_wallets where id=p_wallet for update;
  if not found or wallet.suspended then return; end if;
  for rating in
    select latest.* from (select distinct on(r.call_id) r.* from public.client_call_ratings r where r.client_id=wallet.client_id order by r.call_id,r.revision desc) latest
      join public.calls c on c.id=latest.call_id where latest.amount is not null order by c.started_at,c.id
  loop
    select coalesce(-sum(e.amount),0) into paid from public.client_wallet_entries e join public.client_call_ratings r on r.id=e.rating_id where r.call_id=rating.call_id;
    difference:=rating.amount-paid;
    if difference<0 then
      perform private.client_credit_entry(wallet.id,-difference,'call_refund','rating:'||rating.id::text||':refund:'||rating.amount::text,'Call duration correction',rating.id);
      paid:=rating.amount;
    elsif difference>0 then
      select * into wallet from public.client_wallets where id=wallet.id;
      deduction:=least(wallet.balance,difference);
      if deduction>0 then
        perform private.client_credit_entry(wallet.id,-deduction,'call_charge','rating:'||rating.id::text||':paid:'||(paid+deduction)::text,'Germany calling usage',rating.id);
        paid:=paid+deduction;
      end if;
    end if;
    update public.calls set billing_status=case when rating.amount=0 then 'not_billable' when paid>=rating.amount then 'charged' else 'pending_credit' end,
      customer_charge=rating.amount,currency=wallet.currency where id=rating.call_id;
  end loop;
end $$;
revoke all on function private.settle_client_credit(uuid) from public,anon,authenticated;

create function public.adjust_client_balance(p_client uuid,p_type text,p_amount numeric,p_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare wallet public.client_wallets; previous public.client_balance_operations; delta numeric; pending numeric;
begin
  if not private.platform_permission('finance.write') then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('set','credit','debit') or p_amount is null or p_amount<0 or p_amount<>round(p_amount,6)
    or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or (p_type<>'set' and p_amount=0)
    or length(coalesce(p_key,'')) not between 8 and 200 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_TRANSACTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('client-balance:'||p_key,0));
  select * into previous from public.client_balance_operations where reference_key=p_key;
  if found then
    if previous.client_id<>p_client or previous.type<>p_type or previous.amount<>p_amount or previous.reason<>p_reason then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('balance',previous.balance_after,'replayed',true);
  end if;
  select * into wallet from public.client_wallets where client_id=p_client and is_seed=private.demo_mode() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if wallet.suspended then raise exception 'WALLET_SUSPENDED'; end if;
  pending:=private.client_pending_usage(p_client);
  delta:=case p_type when 'set' then p_amount-wallet.balance+pending when 'credit' then p_amount else -p_amount end;
  if p_type='debit' and wallet.balance-p_amount<pending then raise exception 'INSUFFICIENT_BALANCE'; end if;
  if delta<>0 then perform private.client_credit_entry(wallet.id,delta,case when p_type='set' then 'adjustment' else p_type end,'manual:'||p_key,p_reason); end if;
  perform private.settle_client_credit(wallet.id);
  select * into wallet from public.client_wallets where id=wallet.id;
  insert into public.client_balance_operations(reference_key,wallet_id,client_id,company_id,type,amount,reason,balance_after,created_by)
    values(p_key,wallet.id,p_client,wallet.company_id,p_type,p_amount,p_reason,wallet.balance,auth.uid());
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(wallet.company_id,auth.uid(),'client.balance_adjusted',p_client,jsonb_build_object('type',p_type,'requested_amount',p_amount,'balance',wallet.balance,'currency',wallet.currency));
  return jsonb_build_object('balance',wallet.balance,'currency',wallet.currency,'replayed',false);
end $$;
revoke all on function public.adjust_client_balance(uuid,text,numeric,text,text) from public,anon;
grant execute on function public.adjust_client_balance(uuid,text,numeric,text,text) to authenticated,service_role;

create function public.set_client_germany_rate(p_client uuid,p_per_minute numeric) returns uuid language plpgsql security definer set search_path = '' as $$
declare wallet public.client_wallets; new_rate uuid;
begin
  if not private.platform_permission('pricing.manage') then raise exception 'FORBIDDEN'; end if;
  if p_per_minute is null or p_per_minute<0 or p_per_minute<>round(p_per_minute,6) or p_per_minute in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'INVALID_RATE'; end if;
  select * into wallet from public.client_wallets where client_id=p_client and is_seed=private.demo_mode() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.client_rates(client_id,company_id,currency,per_minute,valid_from,created_by)
    values(p_client,wallet.company_id,wallet.currency,p_per_minute,clock_timestamp(),auth.uid()) returning id into new_rate;
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(wallet.company_id,auth.uid(),'client.rate_changed',p_client,jsonb_build_object('prefix','49','per_minute',p_per_minute,'currency',wallet.currency));
  return new_rate;
end $$;
revoke all on function public.set_client_germany_rate(uuid,numeric) from public,anon;
grant execute on function public.set_client_germany_rate(uuid,numeric) to authenticated,service_role;

create function private.rate_client_call(p_wallet uuid,p_call uuid) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  wallet public.client_wallets; c public.calls; previous public.client_call_ratings; rate public.client_rates;
  signature text; normalized_number text; billable bigint:=0; amount numeric; reason text; snapshot jsonb:='{}';
begin
  -- Wallet before call is the common lock order for billing, funding, and retries.
  select * into wallet from public.client_wallets where id=p_wallet for update;
  if not found or wallet.suspended or wallet.is_seed<>private.demo_mode() then return false; end if;
  select calls.* into c from public.calls calls join public.clients cl on cl.user_id=calls.user_id and cl.company_id=calls.company_id
    where calls.id=p_call and cl.id=wallet.client_id for update of calls;
  if not found or c.started_at<wallet.billing_from or c.ended_at is null or c.ended_at>clock_timestamp()-interval '60 seconds'
    or c.talk_seconds is null or c.is_seed<>wallet.is_seed then return false; end if;
  signature:=private.client_call_signature(c);
  select * into previous from public.client_call_ratings where call_id=c.id order by revision desc limit 1;
  if previous.id is not null and previous.source_signature=signature then return false; end if;
  if previous.id is not null and previous.client_id<>wallet.client_id then raise exception 'BILLED_OWNERSHIP_MISMATCH'; end if;
  if exists(select 1 from public.call_charges where call_id=c.id) then return false; end if;
  if c.status is distinct from 'answer' or c.talk_seconds=0 or c.direction is distinct from 'outbound' then
    amount:=0; reason:='not_billable';
  elsif c.ended_at<c.started_at or c.talk_seconds>ceil(extract(epoch from c.ended_at-c.started_at))+1 then
    amount:=null; reason:='duration_review';
  else
    normalized_number:=regexp_replace(coalesce(c.destination,''),'[^0-9]','','g');
    if normalized_number like '00%' then normalized_number:=substr(normalized_number,3); end if;
    if previous.rate_id is not null then select * into rate from public.client_rates where id=previous.rate_id;
    else
      select * into rate from public.client_rates where client_id=wallet.client_id and valid_from<=c.started_at
        and normalized_number like prefix||'%' order by length(prefix) desc,valid_from desc,id desc limit 1;
    end if;
    if rate.id is null or normalized_number not like rate.prefix||'%' then reason:='unpriced'; amount:=null;
    elsif c.currency is distinct from wallet.currency or rate.currency<>wallet.currency then reason:='currency_review'; amount:=null;
    else
      billable:=ceil(c.talk_seconds::numeric/rate.increment_seconds)::bigint*rate.increment_seconds;
      amount:=round(billable::numeric*rate.per_minute/60,6); reason:='rated'; snapshot:=to_jsonb(rate);
    end if;
  end if;
  insert into public.client_call_ratings(client_id,company_id,call_id,rate_id,revision,source_signature,talk_seconds,billable_seconds,amount,currency,reason,rate_snapshot)
    values(wallet.client_id,wallet.company_id,c.id,rate.id,coalesce(previous.revision,0)+1,signature,c.talk_seconds,billable,amount,wallet.currency,reason,snapshot);
  update public.calls set customer_charge=case when amount is null and previous.amount is not null then previous.amount else amount end,
    billing_status=case when amount is null then reason when amount=0 then 'not_billable' else 'pending_credit' end where id=c.id;
  return true;
end $$;
revoke all on function private.rate_client_call(uuid,uuid) from public,anon,authenticated;

create function public.process_client_billing(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path = '' as $$
declare wallet record; candidate record; processed integer:=0; settled integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_limit<1 or p_limit>500 then raise exception 'INVALID_REQUEST'; end if;
  if private.demo_mode() then return jsonb_build_object('processed',0,'wallets',0); end if;
  for wallet in
    select w.id,w.client_id,w.company_id,w.billing_from,cl.user_id from public.client_wallets w join public.clients cl on cl.id=w.client_id
    where not w.suspended and not w.is_seed and (
      exists(select 1 from public.calls c where c.user_id=cl.user_id and c.company_id=w.company_id and c.started_at>=w.billing_from
        and c.ended_at<=clock_timestamp()-interval '60 seconds' and c.talk_seconds is not null
        and not exists(select 1 from public.call_charges ch where ch.call_id=c.id)
        and coalesce((select r.source_signature from public.client_call_ratings r where r.call_id=c.id order by revision desc limit 1),'')<>private.client_call_signature(c))
      or (w.balance>0 and private.client_pending_usage(w.client_id)>0)
    ) order by w.updated_at,w.id for update of w skip locked
  loop
    for candidate in
      select c.id from public.calls c where c.user_id=wallet.user_id and c.company_id=wallet.company_id and c.started_at>=wallet.billing_from
        and c.ended_at<=clock_timestamp()-interval '60 seconds' and c.talk_seconds is not null
        and not exists(select 1 from public.call_charges ch where ch.call_id=c.id)
        and coalesce((select r.source_signature from public.client_call_ratings r where r.call_id=c.id order by revision desc limit 1),'')<>private.client_call_signature(c)
      order by c.started_at,c.id limit greatest(p_limit-processed,0)
    loop
      if private.rate_client_call(wallet.id,candidate.id) then processed:=processed+1; end if;
    end loop;
    perform private.settle_client_credit(wallet.id); settled:=settled+1;
    update public.client_wallets set updated_at=clock_timestamp() where id=wallet.id;
    exit when processed>=p_limit;
  end loop;
  return jsonb_build_object('processed',processed,'wallets',settled);
end $$;
revoke all on function public.process_client_billing(integer) from public,anon,authenticated;
grant execute on function public.process_client_billing(integer) to service_role;

create function public.client_balance_overview(p_client uuid default null,p_company uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare wallets jsonb; ledger jsonb;
begin
  if not private.active_user() then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(to_jsonb(result)),'[]') into wallets from (
    select w.*,cl.name as client_name,u.email as client_email,co.name as company_name,
      private.client_pending_usage(cl.id) as pending_usage,
      (select per_minute from public.client_rates r where r.client_id=cl.id and r.prefix='49' and r.valid_from<=clock_timestamp() order by r.valid_from desc,r.id desc limit 1) as germany_rate
    from public.client_wallets w join public.clients cl on cl.id=w.client_id join auth.users u on u.id=cl.user_id join public.companies co on co.id=w.company_id
    where w.is_seed=private.demo_mode() and (p_client is null or w.client_id=p_client) and (p_company is null or w.company_id=p_company)
      and (private.platform_permission('finance.read') or private.company_permission(w.company_id,'finance.read') or (cl.user_id=auth.uid() and private.company_access(cl.company_id)))
    order by cl.created_at,cl.id limit 500
  ) result;
  select coalesce(jsonb_agg(to_jsonb(result)),'[]') into ledger from (
    select e.id,e.client_id,e.currency,e.type,e.amount,e.balance_after,e.reason,e.created_at,cl.name as client_name,
      r.call_id,r.talk_seconds,r.billable_seconds,r.amount as call_charge,r.rate_snapshot->>'per_minute' as per_minute
    from public.client_wallet_entries e join public.clients cl on cl.id=e.client_id left join public.client_call_ratings r on r.id=e.rating_id
    where e.is_seed=private.demo_mode() and (p_client is null or e.client_id=p_client) and (p_company is null or e.company_id=p_company)
      and (private.platform_permission('finance.read') or private.company_permission(e.company_id,'finance.read') or (cl.user_id=auth.uid() and private.company_access(cl.company_id)))
    order by e.created_at desc,e.id desc limit 100
  ) result;
  return jsonb_build_object('wallets',wallets,'transactions',ledger);
end $$;
revoke all on function public.client_balance_overview(uuid,uuid) from public,anon;
grant execute on function public.client_balance_overview(uuid,uuid) to authenticated,service_role;

-- Preserve the old company/staff rating implementation, but never let it debit
-- a company wallet for a client's call in addition to the new retail ledger.
alter function public.rate_call(uuid,uuid) rename to rate_company_call;
revoke all on function public.rate_company_call(uuid,uuid) from public,anon,authenticated,service_role;
create function public.rate_call(p_call uuid,p_version uuid) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.calls c join public.clients cl on cl.user_id=c.user_id and cl.company_id=c.company_id where c.id=p_call) then raise exception 'CLIENT_BILLING_MANAGED'; end if;
  return public.rate_company_call(p_call,p_version);
end $$;
revoke all on function public.rate_call(uuid,uuid) from public,anon;
grant execute on function public.rate_call(uuid,uuid) to authenticated;
