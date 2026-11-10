import { randomUUID } from "node:crypto";
import { sql } from "./management.mjs";
const admin = randomUUID(),
  agentA = randomUUID(),
  agentB = randomUUID(),
  manager = randomUUID(),
  provider = randomUUID(),
  did = randomUUID();
const claims = (id, role = "authenticated", aal = "aal1") =>
  `select set_config('request.jwt.claims','${JSON.stringify({ sub: id, role, aal })}',true);`;
const query = `begin;
insert into public.system_settings(key,value) values('data_mode','"live"'::jsonb) on conflict(key) do update set value=excluded.value;
create temporary table verification_ids(k text primary key,id uuid not null);
grant all on verification_ids to authenticated,service_role;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'LIVE_ASSERTION_FAILED: %',label; end if; end $$;
insert into auth.users(id,email,raw_user_meta_data) values
('${admin}','verify-admin-${admin}@example.invalid','{"full_name":"Transactional verification"}'),
('${agentA}','verify-agent-${agentA}@example.invalid','{}'),
('${agentB}','verify-agent-${agentB}@example.invalid','{}'),
('${manager}','verify-manager-${manager}@example.invalid','{}');
update public.profiles set platform_role='super_admin' where id='${admin}';
${claims(admin)} set local role authenticated;
insert into verification_ids select 'a',public.create_company('[Verification] Company A','verify-${randomUUID()}','test@example.invalid','Germany','EUR');
insert into verification_ids select 'b',public.create_company('[Verification] Company B','verify-${randomUUID()}','test@example.invalid','Italy','EUR');
reset role;
insert into public.company_memberships(company_id,user_id,role,manager_id) values
((select id from verification_ids where k='a'),'${agentA}','agent','${manager}'),
((select id from verification_ids where k='b'),'${agentB}','agent',null),
((select id from verification_ids where k='a'),'${manager}','manager',null);
insert into public.provider_accounts(id,name,currency) values('${provider}','[Verification] Upstream','EUR');
insert into public.did_numbers(id,provider_account_id,provider_resource_id,number) values('${did}','${provider}','verification','+12025550123');
${claims(admin)} set local role authenticated;
select public.allocate_did('${did}',(select id from verification_ids where k='a'),'${agentA}',0);
do $$ begin begin perform public.allocate_did('${did}',(select id from verification_ids where k='b'),'${agentB}',0);raise exception 'LIVE_ASSERTION_FAILED: conflicting allocation allowed';exception when others then if sqlerrm not like '%ALLOCATION_CONFLICT%' then raise;end if;end;end $$;
select public.wallet_post((select id from public.customer_wallets where company_id=(select id from verification_ids where k='a')),10,'credit','verify-${admin}','Transactional verification');
select public.wallet_post((select id from public.customer_wallets where company_id=(select id from verification_ids where k='a')),10,'credit','verify-${admin}','Transactional verification');
reset role;
select pg_temp.assert_true((select balance=10 from public.customer_wallets where company_id=(select id from verification_ids where k='a')),'idempotent wallet credit');
${claims(admin, "service_role")}
select public.import_call('${provider}','verification-call','+12025550123','+12025550124',now()+interval '1 second',now()+interval '2 seconds',1,'outbound','answer',0.01,'{}','+12025550123');
select public.import_call('${provider}','verification-call','+12025550123','+12025550124',now()+interval '1 second',now()+interval '2 seconds',1,'outbound','answer',0.01,'{}','+12025550123');
select pg_temp.assert_true((select count(*)=1 from public.calls where provider_account_id='${provider}'),'duplicate call import');
${claims(agentA)} set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.companies),'company isolation');
select pg_temp.assert_true((select count(*)=1 from public.calls),'personal call scope');
select pg_temp.assert_true((select count(*)=0 from public.customer_wallets),'agent financial isolation');
do $$ begin begin perform provider_cost from public.calls;raise exception 'LIVE_ASSERTION_FAILED: wholesale leaked';exception when insufficient_privilege then null;end;end $$;
do $$ begin begin perform ciphertext from private.provider_credentials;raise exception 'LIVE_ASSERTION_FAILED: credentials readable';exception when insufficient_privilege then null;end;end $$;
${claims(agentB)}
select pg_temp.assert_true((select count(*)=0 from public.calls),'cross-company calls denied');
${claims(manager)}
select pg_temp.assert_true((select count(*)=1 from public.calls),'assigned manager scope');
${claims(admin, "authenticated", "aal1")}
select public.wallet_post((select id from public.customer_wallets where company_id=(select id from verification_ids where k='a')),1,'credit','verify-password-${admin}','Password session verification');
select pg_temp.assert_true((select balance=11 from public.customer_wallets where company_id=(select id from verification_ids where k='a')),'password-only admin financial access');
reset role;
rollback;`;
await sql(query);
console.log(
  "Live verification passed: tenant isolation, personal/manager call scope, wholesale denial, credential denial, allocation conflict, idempotent wallet credits, duplicate call imports, password-only administrator access. All test data rolled back.",
);
const remainder = await sql(
  "select (select count(*) from auth.users) as auth_users,(select count(*) from public.companies) as companies,(select count(*) from public.provider_accounts) as providers,(select count(*) from public.wallet_transactions) as ledger_entries",
  true,
);
console.log(JSON.stringify({ postVerificationCounts: remainder }));
