import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { buildDemoFixture } from "../scripts/demo-fixture";
const db = new PGlite();
const owner = "10000000-0000-4000-8000-000000000001";
async function scalar<T = number>(
  query: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(query, params);
  return Object.values(result.rows[0])[0];
}
beforeAll(async () => {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`begin;${buildDemoFixture().query}commit;`);
  await db.query(
    "insert into auth.users(id,email) values($1,'owner@example.invalid')",
    [owner],
  );
  await db.query(
    "update public.profiles set platform_role='super_admin' where id=$1",
    [owner],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: owner, role: "authenticated", aal: "aal1" }),
  ]);
});
afterAll(async () => {
  await db.close();
});
describe("demo dataset and live-data separation", () => {
  it("loads three disconnected sources, six companies, thirty employees, and 1,800 calls", async () => {
    expect(
      await scalar(
        "select count(*)::int from provider_accounts where is_seed and status='disabled'",
      ),
    ).toBe(3);
    expect(
      await scalar("select count(*)::int from companies where is_seed"),
    ).toBe(6);
    expect(
      await scalar(
        "select count(*)::int from company_memberships where is_seed",
      ),
    ).toBe(30);
    expect(await scalar("select count(*)::int from calls where is_seed")).toBe(
      1800,
    );
  });
  it("creates synthetic numbers across provider accounts within each company", async () => {
    expect(
      await scalar(
        "select count(*)::int from (select a.company_id from did_allocations a join did_numbers n on n.id=a.did_id group by a.company_id having count(distinct n.provider_account_id)=3) x",
      ),
    ).toBe(6);
  });
  it("keeps wallet aggregates equal to the immutable ledger", async () => {
    expect(
      await scalar(
        "select count(*)::int from customer_wallets w where w.balance<>coalesce((select sum(t.amount) from wallet_transactions t where t.wallet_id=w.id),0)",
      ),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int from customer_wallets where balance<0",
      ),
    ).toBe(0);
  });
  it("stores no provider credentials and no verified provider operations", async () => {
    expect(
      await scalar("select count(*)::int from private.provider_credentials"),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int from provider_accounts where cardinality(verified_resources)>0 or last_successful_sync is not null",
      ),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int from caller_id_permissions where enabled",
      ),
    ).toBe(0);
  });
  it("prevents the synthetic employee identities from signing in", async () =>
    expect(
      await scalar(
        "select count(*)::int from profiles where is_seed and not suspended",
      ),
    ).toBe(0));
  it("exports only the current dataset", async () => {
    expect(
      (
        await scalar<{ total: number }>(
          "select export_calls('1970-01-01','2100-01-01')",
        )
      ).total,
    ).toBe(1800);
    await db.exec(
      "update system_settings set value='\"live\"'::jsonb where key='data_mode'",
    );
    expect(
      (
        await scalar<{ total: number }>(
          "select export_calls('1970-01-01','2100-01-01')",
        )
      ).total,
    ).toBe(0);
    expect(await scalar("select count(*)::int from calls")).toBe(1800);
  });
  it("blocks modification of demo wallets from live mode", async () => {
    const wallet = await scalar<string>(
      "select id from customer_wallets where is_seed limit 1",
    );
    await expect(
      db.query(
        "select public.wallet_post($1,1,'credit','cross-mode-credit','Test isolation')",
        [wallet],
      ),
    ).rejects.toThrow(/DATA_MODE_MISMATCH/);
  });
  it("can create a clean live company while demo records remain archived", async () => {
    const company = await scalar<string>(
      "select create_company('Live fixture','live-fixture','fixture@example.invalid','Germany','EUR')",
    );
    expect(
      await scalar<boolean>("select is_seed from companies where id=$1", [
        company,
      ]),
    ).toBe(false);
    expect(
      await scalar("select count(*)::int from companies where not is_seed"),
    ).toBe(1);
    await db.exec(
      "update system_settings set value='\"demo\"'::jsonb where key='data_mode'",
    );
    expect(
      await scalar(
        "select count(*)::int from companies where is_seed=private.demo_mode()",
      ),
    ).toBe(6);
  });
  it("rejects allocations between demo and live companies", async () => {
    const live = await scalar<string>(
        "select id from companies where not is_seed",
      ),
      did = await scalar<string>("select id from did_numbers limit 1");
    await expect(
      db.query(
        "insert into did_allocations(did_id,company_id,monthly_price) values($1,$2,0)",
        [did, live],
      ),
    ).rejects.toThrow(/DATA_MODE_MISMATCH/);
  });
  it("blocks real provider onboarding in demo mode at the database boundary", async () => {
    await expect(
      db.query(
        "select create_provider($1,'Forbidden live connection','EUR','test-ciphertext')",
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow(/DEMO_PROVIDER_DISABLED/);
  });
  it("rolls back cleanup when a platform administrator is marked synthetic", async () => {
    await db.exec("begin");
    await db.query("update profiles set is_seed=true where id=$1", [owner]);
    await expect(
      db.exec(
        await readFile(
          "supabase/migrations/202611090012_remove_demo_data.sql",
          "utf8",
        ),
      ),
    ).rejects.toThrow(/DEMO_CLEANUP_PROTECTED_IDENTITY/);
    await db.exec("rollback");
    expect(await scalar("select count(*)::int from calls where is_seed")).toBe(
      1800,
    );
    expect(
      await scalar(
        "select count(*)::int from pg_trigger where tgname in ('audit_immutable','charge_immutable','version_immutable','ledger_immutable') and tgenabled='O'",
      ),
    ).toBe(4);
  });
  it("permanently removes synthetic data and identities while preserving live data and immutable history", async () => {
    await db.exec(
      "update system_settings set value='\"live\"'::jsonb where key='data_mode'",
    );
    const provider = await scalar<string>(
      "select create_provider($1,'Live provider','EUR','live-encrypted-fixture')",
      [crypto.randomUUID()],
    );
    const wallet = await scalar<string>(
      "select id from customer_wallets where not is_seed",
    );
    await db.query(
      "select wallet_post($1,12,'credit','live-cleanup-fixture','Live credit')",
      [wallet],
    );
    await db.exec(
      await readFile(
        "supabase/migrations/202611090012_remove_demo_data.sql",
        "utf8",
      ),
    );
    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema='public' and column_name='is_seed'",
    );
    for (const { table_name } of tables.rows)
      expect(
        await scalar(
          `select count(*)::int from public.\"${table_name}\" where is_seed`,
        ),
      ).toBe(0);
    expect(await scalar("select count(*)::int from auth.users")).toBe(1);
    expect(
      await scalar("select platform_role from profiles where id=$1", [owner]),
    ).toBe("super_admin");
    expect(await scalar("select count(*)::int from companies")).toBe(1);
    expect(
      await scalar("select balance::text from customer_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("12.000000");
    expect(await scalar("select count(*)::int from wallet_transactions")).toBe(
      1,
    );
    expect(
      await scalar(
        "select ciphertext from private.provider_credentials where provider_account_id=$1",
        [provider],
      ),
    ).toBe("live-encrypted-fixture");
    await expect(db.exec("delete from wallet_transactions")).rejects.toThrow(
      /IMMUTABLE/,
    );
    expect(
      await scalar(
        "select value #>> '{}' from system_settings where key='data_mode'",
      ),
    ).toBe("live");
  });
});
