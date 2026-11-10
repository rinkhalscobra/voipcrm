-- Explicitly requested transition to live data. Remove only tagged synthetic rows.
-- The entire block is atomic, including the temporary suspension of immutable
-- record triggers. Foreign keys and live-row counts remain enforced throughout.
do $$
declare
  dataset record;
  protected_trigger record;
  remaining bigint;
  live_rows bigint;
  seed_rows bigint;
  seed_users bigint;
  removed_counts jsonb;
begin
  lock table auth.users in share row exclusive mode;
  create temporary table voixel_demo_cleanup (
    table_oid oid primary key,
    table_name name not null,
    live_count bigint not null default 0,
    seed_count bigint not null default 0,
    processed boolean not null default false
  ) on commit drop;
  insert into voixel_demo_cleanup(table_oid,table_name)
  select c.oid,c.relname from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attname='is_seed' and not a.attisdropped
  where n.nspname='public' and c.relkind='r';

  for dataset in select * from voixel_demo_cleanup order by table_name loop
    execute format('lock table public.%I in access exclusive mode',dataset.table_name);
    execute format('select count(*) filter(where not is_seed),count(*) filter(where is_seed) from public.%I',dataset.table_name)
      into live_rows,seed_rows;
    update voixel_demo_cleanup set live_count=live_rows,seed_count=seed_rows where table_oid=dataset.table_oid;
  end loop;

  if exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.is_seed and (p.platform_role is not null or not p.suspended or u.raw_user_meta_data->>'demo' is distinct from 'true')
  ) then
    raise exception 'DEMO_CLEANUP_PROTECTED_IDENTITY';
  end if;
  if exists (
    select 1 from auth.users u left join public.profiles p on p.id=u.id
    where u.raw_user_meta_data->>'demo'='true' and coalesce(p.is_seed,false)=false
  ) then
    raise exception 'DEMO_CLEANUP_INCONSISTENT_IDENTITY';
  end if;
  create temporary table voixel_demo_users on commit drop as
    select id from public.profiles where is_seed;
  select count(*) into seed_users from voixel_demo_users;

  -- Only these four known append-only triggers are suspended, under table locks.
  for protected_trigger in select * from (values
    ('audit_logs','audit_immutable'),
    ('call_charges','charge_immutable'),
    ('pricing_plan_versions','version_immutable'),
    ('wallet_transactions','ledger_immutable')
  ) as triggers(table_name,trigger_name) loop
    if not exists (
      select 1 from pg_trigger t where t.tgrelid=format('public.%I',protected_trigger.table_name)::regclass
      and t.tgname=protected_trigger.trigger_name and t.tgenabled='O'
    ) then raise exception 'DEMO_CLEANUP_TRIGGER_STATE'; end if;
    execute format('alter table public.%I disable trigger %I',protected_trigger.table_name,protected_trigger.trigger_name);
  end loop;

  delete from private.call_payloads where call_id in (select id from public.calls where is_seed);
  delete from private.provider_credentials where provider_account_id in (select id from public.provider_accounts where is_seed);
  delete from public.user_permissions where user_id in (select id from voixel_demo_users);

  -- Delete children before parents. Unmarked references fail their foreign keys
  -- and roll back this entire operation rather than deleting live records.
  loop
    select count(*) into remaining from voixel_demo_cleanup where not processed;
    exit when remaining=0;
    select candidate.* into dataset from voixel_demo_cleanup candidate
    where not candidate.processed and not exists (
      select 1 from pg_constraint fk join voixel_demo_cleanup child on child.table_oid=fk.conrelid
      where fk.contype='f' and fk.confrelid=candidate.table_oid and not child.processed
        and child.table_oid<>candidate.table_oid
    ) order by candidate.table_name limit 1;
    if not found then raise exception 'DEMO_CLEANUP_DEPENDENCY_CYCLE'; end if;
    execute format('delete from public.%I where is_seed',dataset.table_name);
    update voixel_demo_cleanup set processed=true where table_oid=dataset.table_oid;
  end loop;
  delete from auth.users where id in (select id from voixel_demo_users);

  for protected_trigger in select * from (values
    ('audit_logs','audit_immutable'),
    ('call_charges','charge_immutable'),
    ('pricing_plan_versions','version_immutable'),
    ('wallet_transactions','ledger_immutable')
  ) as triggers(table_name,trigger_name) loop
    execute format('alter table public.%I enable trigger %I',protected_trigger.table_name,protected_trigger.trigger_name);
  end loop;

  for dataset in select * from voixel_demo_cleanup loop
    execute format('select count(*) filter(where not is_seed),count(*) filter(where is_seed) from public.%I',dataset.table_name)
      into live_rows,seed_rows;
    if seed_rows<>0 or live_rows<>dataset.live_count then
      raise exception 'DEMO_CLEANUP_DATA_INVARIANT: %',dataset.table_name;
    end if;
  end loop;
  insert into public.system_settings(key,value) values('data_mode','"live"'::jsonb)
    on conflict(key) do update set value=excluded.value,updated_at=now();
  select coalesce(jsonb_object_agg(table_name,seed_count) filter(where seed_count>0),'{}'::jsonb)
    into removed_counts from voixel_demo_cleanup;
  if removed_counts<>'{}'::jsonb then
    insert into public.audit_logs(action,metadata)
    values('demo_data.removed',jsonb_build_object('removed_rows',removed_counts,'removed_auth_users',seed_users,'data_mode','live'));
  end if;
end $$;
