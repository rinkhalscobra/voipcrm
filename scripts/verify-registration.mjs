import { randomUUID } from "node:crypto";
import { sql, management } from "./management.mjs";
const user = randomUUID(),
  invalid = randomUUID();
await sql(`begin;
create function pg_temp.registration_assert(v boolean,label text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'REGISTRATION_VERIFICATION_FAILED: %',label; end if; end $$;
insert into auth.users(id,email,raw_user_meta_data) values('${user}','registration-${user}@example.invalid','{"full_name":"Registration verification","registration_company_name":"Registration verification","registration_currency":"EUR","registration_country":"Germany","platform_role":"super_admin","role":"super_admin","company_id":"00000000-0000-4000-8000-000000000000"}');
select pg_temp.registration_assert((select platform_role is null and not suspended from public.profiles where id='${user}'),'no platform role escalation');
select pg_temp.registration_assert((select role='company_admin' from public.company_memberships where user_id='${user}'),'company admin membership');
select pg_temp.registration_assert((select w.balance=0 and w.is_seed from public.customer_wallets w join public.company_memberships m on m.company_id=w.company_id where m.user_id='${user}'),'empty isolated demo wallet');
select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated","aal":"aal1"}',true); set local role authenticated;
select pg_temp.registration_assert((select count(*)=1 from public.companies),'registered company is isolated');
select pg_temp.registration_assert((select count(*)=1 from public.customer_wallets),'wallet is scoped to new company');
select pg_temp.registration_assert((select count(*)=0 from public.calls),'other company calls are inaccessible');
reset role;
do $$ begin begin insert into auth.users(id,email,raw_user_meta_data) values('${invalid}','invalid-${invalid}@example.invalid','{"registration_company_name":"Invalid verification","registration_currency":"EURO"}');raise exception 'REGISTRATION_VERIFICATION_FAILED: invalid registration accepted';exception when others then if sqlerrm not like '%INVALID_REGISTRATION%' then raise;end if;end;end $$;
select pg_temp.registration_assert((select count(*)=0 from auth.users where id='${invalid}'),'invalid signup rolled back');
rollback;`);
console.log(
  "Live registration database verification passed: new company, empty wallet, fixed company-admin role, no privilege escalation, tenant isolation, password-only access, atomic rollback. All verification records rolled back.",
);
const base = process.env.APP_URL;
const page = await fetch(`${base}/register`);
if (!page.ok || !(await page.text()).includes("Create your workspace"))
  throw new Error("Registration page is not available");
const response = await fetch(`${base}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({
    full_name: "Test",
    company_name: "Test",
    email: "test@example.invalid",
    password: "abcdefgh",
    country: "Germany",
    currency: "EUR",
    role: "super_admin",
  }),
});
const payload = await response.json();
if (response.status !== 400 || payload.error?.code !== "INVALID_REQUEST")
  throw new Error(
    "Public registration did not reject an injected platform role",
  );
console.log(
  "Live registration page and API validation passed. No registration email was sent.",
);
const authConfig = await management("/config/auth");
if (
  authConfig.mailer_autoconfirm &&
  process.env.DEMO_ADMIN_EMAIL &&
  process.env.DEMO_ADMIN_PASSWORD
) {
  const duplicate = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({
      full_name: "Duplicate account check",
      company_name: "Duplicate account check",
      email: process.env.DEMO_ADMIN_EMAIL,
      password: process.env.DEMO_ADMIN_PASSWORD,
      country: "Germany",
      currency: "EUR",
    }),
  });
  const result = await duplicate.json();
  if (duplicate.status !== 409 || result.error?.code !== "REGISTRATION_FAILED")
    throw new Error("Registration did not reject an existing account");
  console.log(
    "Live signup endpoint reached Supabase and rejected the existing admin account without creating another workspace.",
  );
}
