import { readFile, writeFile } from "node:fs/promises";
import { sql, projectRef } from "./management.mjs";
import { buildDemoFixture } from "./demo-fixture";
const state = await sql(
  "select (select count(*) from public.companies where not is_seed) as live_companies,(select count(*) from public.provider_accounts where not is_seed) as live_providers,(select count(*) from public.companies where is_seed) as demo_companies",
  true,
);
if (Number(state[0].live_companies) || Number(state[0].live_providers))
  throw new Error(
    "Demo initialization requires a project without live companies or providers. Existing live data is never changed.",
  );
if (!Number(state[0].demo_companies)) {
  const fixture = buildDemoFixture();
  await sql(
    `begin; select pg_advisory_xact_lock(hashtextextended('voixel-demo-initialization',0)); ${fixture.query}\n commit;`,
  );
} else
  await sql(
    "insert into public.system_settings(key,value) values('data_mode','\"demo\"'::jsonb) on conflict(key) do update set value=excluded.value,updated_at=now();",
  );
let env = await readFile(".env", "utf8");
env = /^DATA_MODE=/m.test(env)
  ? env.replace(/^DATA_MODE=.*$/m, "DATA_MODE=demo")
  : `${env.trimEnd()}\nDATA_MODE=demo\n`;
await writeFile(".env", env, { mode: 0o600 });
const counts = await sql(
  "select (select count(*) from public.provider_accounts where is_seed) as providers,(select count(*) from public.companies where is_seed) as companies,(select count(*) from public.company_memberships where is_seed) as employees,(select count(*) from public.did_numbers where is_seed) as numbers,(select count(*) from public.calls where is_seed) as calls,(select count(*) from public.invoices where is_seed) as invoices",
  true,
);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const branding = {
  platform_name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel",
  support_email: process.env.BOOTSTRAP_EMAIL ?? "",
  timezone: "Europe/Berlin",
  default_currency: "EUR",
};
await sql(
  `insert into public.system_settings(key,value) values('branding',${quote(JSON.stringify(branding))}::jsonb) on conflict(key) do nothing;`,
);
console.log(
  JSON.stringify({
    project: projectRef,
    dataMode: "demo",
    seeded: counts[0],
    externalProviderRequests: false,
    credentialsModified: false,
  }),
);
