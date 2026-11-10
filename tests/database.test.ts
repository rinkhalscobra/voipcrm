import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const db = new PGlite();
const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  a: "00000000-0000-4000-8000-000000000002",
  b: "00000000-0000-4000-8000-000000000003",
  manager: "00000000-0000-4000-8000-000000000004",
  other: "00000000-0000-4000-8000-000000000005",
  leader: "00000000-0000-4000-8000-000000000006",
  platform: "00000000-0000-4000-8000-000000000007",
};
let companyA: string,
  companyB: string,
  wallet: string,
  provider: string,
  did: string;
async function session(user: string, role = "authenticated", aal = "aal1") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, role, aal }),
  ]);
  await db.exec(`set role ${role}`);
}
async function superuser() {
  await db.exec("reset role");
}
async function scalar<T = string>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0])[0];
}
beforeAll(async () => {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`,
  );
  const files = (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const file of files)
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${name}@fixture.invalid`,
    ]);
    await db.query("update public.profiles set full_name=$2 where id=$1", [
      id,
      name,
    ]);
  }
  await db.query(
    "update public.profiles set platform_role='super_admin' where id=$1",
    [ids.admin],
  );
  await db.query(
    "update public.profiles set platform_role='platform_admin' where id=$1",
    [ids.platform],
  );
  await session(ids.admin);
  companyA = await scalar(
    "select public.create_company('Fixture A','fixture-a','a@fixture.invalid','Germany','EUR')",
  );
  companyB = await scalar(
    "select public.create_company('Fixture B','fixture-b','b@fixture.invalid','Italy','EUR')",
  );
  await superuser();
  for (const [user, company, role] of [
    [ids.a, companyA, "agent"],
    [ids.b, companyB, "agent"],
    [ids.manager, companyA, "manager"],
    [ids.other, companyA, "agent"],
    [ids.leader, companyA, "team_leader"],
  ])
    await db.query(
      "insert into company_memberships(company_id,user_id,role,manager_id,team_leader_id) values($1,$2,$3,$4,$5)",
      [company, user, role, ids.manager, ids.leader],
    );
  wallet = await scalar("select id from customer_wallets where company_id=$1", [
    companyA,
  ]);
  provider = await scalar(
    "insert into provider_accounts(name,currency) values('Fixture provider','EUR') returning id",
  );
  did = await scalar(
    "insert into did_numbers(provider_account_id,provider_resource_id,number) values($1,'fixture-did','+493012345678') returning id",
    [provider],
  );
});
afterAll(async () => {
  await db.close();
});
describe("actual PostgreSQL migrations and RLS", () => {
  it("enables RLS on every public table", async () => {
    await superuser();
    expect(
      await scalar<number>(
        "select count(*)::int from pg_tables where schemaname='public' and not rowsecurity",
      ),
    ).toBe(0);
  });
  it("isolates companies at the database boundary", async () => {
    await session(ids.a);
    expect(
      (await db.query<{ id: string }>("select id from companies")).rows.map(
        (r) => r.id,
      ),
    ).toEqual([companyA]);
  });
  it("does not allow an agent to read wallets", async () => {
    await session(ids.a);
    expect(
      (await db.query("select id from customer_wallets")).rows,
    ).toHaveLength(0);
  });
  it("denies wholesale call columns even with a valid tenant token", async () => {
    await session(ids.a);
    await expect(db.query("select provider_cost from calls")).rejects.toThrow(
      /permission denied/,
    );
  });
  it("denies provider credentials to authenticated callers", async () => {
    await session(ids.admin);
    await expect(
      db.query("select ciphertext from private.provider_credentials"),
    ).rejects.toThrow(/permission denied/);
  });
  it("denies financial RPCs to unprivileged platform administrators", async () => {
    await session(ids.platform);
    await expect(
      db.query(
        "select public.wallet_post($1,1,'credit','fixture-platform-denied','Test credit')",
        [wallet],
      ),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("allows authorized financial writes with a password-only session", async () => {
    await session(ids.admin, "authenticated", "aal1");
    await db.query(
      "select public.wallet_post($1,1,'credit','fixture-password-credit','Password session verification')",
      [wallet],
    );
    await db.query(
      "select public.wallet_post($1,-1,'debit','fixture-password-debit','Password session verification')",
      [wallet],
    );
    expect(
      await scalar("select balance::text from customer_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("0.000000");
  });
  it("rejects duplicate active DID allocations transactionally", async () => {
    await session(ids.admin);
    await db.query("select public.allocate_did($1,$2,$3,5)", [
      did,
      companyA,
      ids.a,
    ]);
    await expect(
      db.query("select public.allocate_did($1,$2,$3,5)", [
        did,
        companyB,
        ids.b,
      ]),
    ).rejects.toThrow(/ALLOCATION_CONFLICT/);
  });
  it("blocks additional accounts until the primary provider is verified", async () => {
    await session(ids.admin);
    await expect(
      db.query(
        "select public.create_provider($1,'Fixture pending','EUR','fixture-ciphertext')",
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow(/FIRST_ACCOUNT_UNVERIFIED/);
  });
  it("rejects allocating to an employee from another company", async () => {
    await superuser();
    const number = await scalar(
      "insert into did_numbers(provider_account_id,provider_resource_id,number) values($1,'other-fixture','+390212345678') returning id",
      [provider],
    );
    await session(ids.admin);
    await expect(
      db.query("select public.allocate_did($1,$2,$3,5)", [
        number,
        companyA,
        ids.b,
      ]),
    ).rejects.toThrow(/INVALID_MEMBER/);
  });
  it("imports the same provider call once and preserves original ownership", async () => {
    await session(ids.admin, "service_role");
    const start = new Date(Date.now() + 1000).toISOString();
    const call = await scalar(
      "select public.import_call($1,'fixture-call','+493012345678','+390212345678',$2,$2,60,'outbound','answer',0.01,'{}','+493012345678')",
      [provider, start],
    );
    expect(
      await scalar(
        "select public.import_call($1,'fixture-call','+493012345678','+390212345678',$2,$2,61,'outbound','answer',0.02,'{}','+493012345678')",
        [provider, start],
      ),
    ).toBe(call);
    await superuser();
    expect(
      await scalar<number>(
        "select count(*)::int from calls where provider_account_id=$1 and provider_resource_id='fixture-call'",
        [provider],
      ),
    ).toBe(1);
    expect(
      await scalar("select company_id from calls where id=$1", [call]),
    ).toBe(companyA);
  });
  it("allows only assigned managers and agents to read imported calls", async () => {
    await session(ids.a);
    expect((await db.query("select id from calls")).rows).toHaveLength(1);
    await session(ids.manager);
    expect((await db.query("select id from calls")).rows).toHaveLength(1);
    await session(ids.leader);
    expect((await db.query("select id from calls")).rows).toHaveLength(1);
    await session(ids.other);
    expect((await db.query("select id from calls")).rows).toHaveLength(0);
    await session(ids.b);
    expect((await db.query("select id from calls")).rows).toHaveLength(0);
  });
  it("keeps historical ownership after DID reassignment", async () => {
    await session(ids.admin);
    await db.query("select public.unallocate_did($1)", [did]);
    await db.query("select public.allocate_did($1,$2,$3,8)", [
      did,
      companyB,
      ids.b,
    ]);
    await session(ids.a);
    expect((await db.query("select id from calls")).rows).toHaveLength(1);
    expect(
      (await db.query("select * from public.my_numbers()")).rows,
    ).toHaveLength(0);
    await session(ids.b);
    expect((await db.query("select id from calls")).rows).toHaveLength(0);
    expect(
      (await db.query("select * from public.my_numbers()")).rows,
    ).toHaveLength(1);
  });
  it("never attributes an outbound call by its destination", async () => {
    await session(ids.admin, "service_role");
    const call = await scalar(
      "select public.import_call($1,'unresolved-fixture','unknown','+493012345678',now(),now(),60,'outbound','answer',0.01,'{}','unknown')",
      [provider],
    );
    await superuser();
    expect(
      await scalar("select company_id from calls where id=$1", [call]),
    ).toBeNull();
    expect(
      await scalar("select code from billing_exceptions where call_id=$1", [
        call,
      ]),
    ).toBe("UNRESOLVED_OWNERSHIP");
  });
  it("prevents concurrent duplicate credits from creating duplicate entries", async () => {
    await session(ids.admin);
    const requests = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.query(
          "select (public.wallet_post($1,10,'credit','fixture-credit-key','Test credit')).id as id",
          [wallet],
        ),
      ),
    );
    expect(
      new Set(requests.map((r) => (r.rows[0] as { id: string }).id)).size,
    ).toBe(1);
    await superuser();
    expect(
      await scalar("select balance::text from customer_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("10.000000");
  });
  it("rejects reused keys with a different financial intent", async () => {
    await session(ids.admin);
    await expect(
      db.query(
        "select public.wallet_post($1,11,'credit','fixture-credit-key','Test credit')",
        [wallet],
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });
  it("prevents insufficient-balance debits without changing the ledger", async () => {
    await session(ids.admin);
    await expect(
      db.query(
        "select public.wallet_post($1,-11,'debit','fixture-overdraft','Test debit')",
        [wallet],
      ),
    ).rejects.toThrow(/INSUFFICIENT_BALANCE/);
    await superuser();
    expect(
      await scalar("select balance::text from customer_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("10.000000");
  });
  it("serializes competing debit requests and retains a nonnegative balance", async () => {
    await session(ids.admin);
    const results = await Promise.allSettled([
      db.query(
        "select public.wallet_post($1,-7,'debit','fixture-debit-one','Test debit')",
        [wallet],
      ),
      db.query(
        "select public.wallet_post($1,-7,'debit','fixture-debit-two','Test debit')",
        [wallet],
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await superuser();
    expect(
      await scalar("select balance::text from customer_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("3.000000");
  });
  it("prevents ledger mutation even with a service credential", async () => {
    await session(ids.admin, "service_role");
    await expect(
      db.query("update wallet_transactions set amount=100 where wallet_id=$1", [
        wallet,
      ]),
    ).rejects.toThrow(/IMMUTABLE_RECORD/);
  });
  it("issues invoices atomically with decimal tax calculations", async () => {
    await session(ids.admin);
    const invoice = await scalar(
      "select public.issue_invoice($1,'EUR','2026-11-01','2026-11-30','2026-12-10',$2)",
      [
        companyA,
        JSON.stringify([
          {
            description: "Fixture usage",
            quantity: "3",
            unit_price: "0.1",
            tax_percent: "19",
          },
        ]),
      ],
    );
    await superuser();
    expect(
      await scalar("select total::text from invoices where id=$1", [invoice]),
    ).toBe("0.357000");
    expect(
      await scalar("select status from invoices where id=$1", [invoice]),
    ).toBe("issued");
  });
  it("does not mark an invoice paid until confirmed payment covers the total", async () => {
    await superuser();
    const invoice = await scalar("select id from invoices limit 1");
    await session(ids.admin);
    await db.query(
      "select public.record_payment($1,0.1,'EUR','fixture-partial-payment')",
      [invoice],
    );
    await superuser();
    expect(
      await scalar("select status from invoices where id=$1", [invoice]),
    ).toBe("issued");
    await session(ids.admin);
    await db.query(
      "select public.record_payment($1,0.257,'EUR','fixture-final-payment')",
      [invoice],
    );
    await superuser();
    expect(
      await scalar("select status from invoices where id=$1", [invoice]),
    ).toBe("paid");
  });
  it("denies worker job claiming to application users", async () => {
    await session(ids.admin);
    await expect(
      db.query("select * from public.claim_sync_job()"),
    ).rejects.toThrow(/permission denied/);
  });
  it("rates a call exactly once and rolls back a charge when funds are insufficient", async () => {
    await session(ids.admin);
    const version = await scalar(
      "select public.create_pricing_version($1,'Fixture plan','EUR',$2)",
      [
        companyB,
        JSON.stringify([
          {
            prefix: "39",
            per_minute: "0.037",
            connection_fee: "0.01",
            minimum_seconds: 90,
            increment_seconds: 60,
          },
        ]),
      ],
    );
    await session(ids.admin, "service_role");
    const call = await scalar(
      "select public.import_call($1,'rated-fixture','+493012345678','+390212345678',now()+interval '1 second',now()+interval '63 seconds',61,'outbound','answer',0.02,'{}','+493012345678')",
      [provider],
    );
    await session(ids.admin);
    await expect(
      db.query("select public.rate_call($1,$2)", [call, version]),
    ).rejects.toThrow(/INSUFFICIENT_BALANCE/);
    await superuser();
    expect(
      await scalar<number>(
        "select count(*)::int from call_charges where call_id=$1",
        [call],
      ),
    ).toBe(0);
    const secondWallet = await scalar(
      "select id from customer_wallets where company_id=$1",
      [companyB],
    );
    await session(ids.admin);
    await db.query(
      "select public.wallet_post($1,1,'credit','fixture-rating-credit','Test credit')",
      [secondWallet],
    );
    const charge = await scalar("select public.rate_call($1,$2)", [
      call,
      version,
    ]);
    expect(
      await scalar("select public.rate_call($1,$2)", [call, version]),
    ).toBe(charge);
    await superuser();
    expect(
      await scalar("select balance::text from customer_wallets where id=$1", [
        secondWallet,
      ]),
    ).toBe("0.916000");
    expect(
      await scalar("select amount::text from call_charges where id=$1", [
        charge,
      ]),
    ).toBe("0.084000");
    await expect(
      db.query("update pricing_plan_versions set rules='{}' where id=$1", [
        version,
      ]),
    ).rejects.toThrow(/IMMUTABLE_RECORD/);
  });
  it("exports more than one REST page without leaking other-company or wholesale fields", async () => {
    await superuser();
    await db.query(
      "insert into user_permissions(user_id,permission,granted) values($1,'reports.export',true)",
      [ids.a],
    );
    await db.query(
      "insert into calls(provider_account_id,provider_resource_id,company_id,user_id,manager_id,origin,destination,started_at,duration_seconds,direction,status,provider_cost) select $1,'export-fixture-'||n,$2,$3,$4,'+12025550123','+12025550124',now(),1,'outbound','answer',0.01 from generate_series(1,1001) n",
      [provider, companyA, ids.a, ids.manager],
    );
    await session(ids.a);
    const exported = await scalar<{
      rows: Record<string, unknown>[];
      total: number;
    }>("select public.export_calls('1970-01-01','2100-01-01',null,null,null)");
    expect(exported.total).toBe(1002);
    expect(exported.rows).toHaveLength(1002);
    expect(exported.rows[0]).not.toHaveProperty("provider_cost");
    expect(exported.rows[0]).not.toHaveProperty("provider_account_id");
    const other = await scalar<{ rows: unknown[]; total: number }>(
      "select public.export_calls('1970-01-01','2100-01-01',null,$1,null)",
      [companyB],
    );
    expect(other.total).toBe(0);
  });
  it("recovers expired queue leases and rejects stale worker tokens", async () => {
    await superuser();
    const job = await scalar(
      "insert into sync_jobs(provider_account_id,resource) values($1,'balance') returning id",
      [provider],
    );
    await session(ids.admin, "service_role");
    const first = (
      await db.query<{ lease_token: string }>("select * from claim_sync_job()")
    ).rows[0];
    expect(first.lease_token).toBeTruthy();
    expect(
      (await db.query("select * from claim_sync_job()")).rows,
    ).toHaveLength(0);
    await db.query(
      "update sync_jobs set locked_until=now()-interval '1 second' where id=$1",
      [job],
    );
    const second = (
      await db.query<{ lease_token: string }>("select * from claim_sync_job()")
    ).rows[0];
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(
      await scalar<boolean>("select renew_sync_lease($1,$2)", [
        job,
        first.lease_token,
      ]),
    ).toBe(false);
    expect(
      await scalar<boolean>("select renew_sync_lease($1,$2)", [
        job,
        second.lease_token,
      ]),
    ).toBe(true);
  });
  it("self-registration creates an isolated company-admin workspace with an empty wallet", async () => {
    await superuser();
    const user = crypto.randomUUID();
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'registered@example.invalid',$2)",
      [
        user,
        JSON.stringify({
          full_name: "Registered owner",
          registration_company_name: "Registered company",
          registration_currency: "USD",
          registration_country: "United States",
          role: "super_admin",
          platform_role: "super_admin",
          company_id: companyA,
        }),
      ],
    );
    const membership = (
      await db.query<{ company_id: string; role: string }>(
        "select company_id,role from company_memberships where user_id=$1",
        [user],
      )
    ).rows[0];
    expect(membership.company_id).not.toBe(companyA);
    expect(membership.company_id).not.toBe(companyB);
    expect(membership.role).toBe("company_admin");
    expect(
      await scalar("select platform_role from profiles where id=$1", [user]),
    ).toBeNull();
    expect(
      await scalar(
        "select balance::text from customer_wallets where company_id=$1",
        [membership.company_id],
      ),
    ).toBe("0.000000");
    expect(
      await scalar("select currency from companies where id=$1", [
        membership.company_id,
      ]),
    ).toBe("USD");
    await session(user, "authenticated", "aal1");
    expect(
      (await db.query("select id from companies")).rows.map(
        (r) => (r as { id: string }).id,
      ),
    ).toEqual([membership.company_id]);
  });
  it("editing signup metadata cannot elevate a user or move their company", async () => {
    await superuser();
    const user = await scalar(
      "select id from auth.users where email='registered@example.invalid'",
    );
    const company = await scalar(
      "select company_id from company_memberships where user_id=$1",
      [user],
    );
    await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [
      user,
      JSON.stringify({
        platform_role: "super_admin",
        role: "super_admin",
        company_id: companyB,
      }),
    ]);
    expect(
      await scalar("select platform_role from profiles where id=$1", [user]),
    ).toBeNull();
    expect(
      await scalar(
        "select company_id from company_memberships where user_id=$1",
        [user],
      ),
    ).toBe(company);
  });
  it("invalid registration rolls back the auth user and profile together", async () => {
    await superuser();
    const user = crypto.randomUUID();
    await expect(
      db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,'invalid-registration@example.invalid',$2)",
        [
          user,
          JSON.stringify({
            registration_company_name: "Invalid company",
            registration_currency: "EURO",
          }),
        ],
      ),
    ).rejects.toThrow(/INVALID_REGISTRATION/);
    expect(
      await scalar<number>("select count(*)::int from auth.users where id=$1", [
        user,
      ]),
    ).toBe(0);
    expect(
      await scalar<number>("select count(*)::int from profiles where id=$1", [
        user,
      ]),
    ).toBe(0);
  });
  it("a forged invitation cannot fall back to registration in an existing company", async () => {
    await superuser();
    const user = crypto.randomUUID();
    await expect(
      db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,'forged-invitation@example.invalid',$2)",
        [
          user,
          JSON.stringify({
            invitation_id: crypto.randomUUID(),
            registration_company_name: "Forged company",
            company_id: companyA,
          }),
        ],
      ),
    ).rejects.toThrow(/INVALID_INVITATION/);
    expect(
      await scalar<number>("select count(*)::int from auth.users where id=$1", [
        user,
      ]),
    ).toBe(0);
  });
  it("registrations in demo mode inherit demo markers without fabricated credit", async () => {
    await superuser();
    await db.exec(
      "insert into system_settings(key,value) values('data_mode','\"demo\"'::jsonb) on conflict(key) do update set value=excluded.value",
    );
    const user = crypto.randomUUID();
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'demo-registration@example.invalid',$2)",
      [
        user,
        JSON.stringify({
          registration_company_name: "Demo signup company",
          registration_currency: "EUR",
        }),
      ],
    );
    const company = await scalar(
      "select company_id from company_memberships where user_id=$1",
      [user],
    );
    expect(
      await scalar<boolean>("select is_seed from companies where id=$1", [
        company,
      ]),
    ).toBe(true);
    expect(
      await scalar<boolean>("select is_seed from profiles where id=$1", [user]),
    ).toBe(true);
    expect(
      await scalar(
        "select balance::text from customer_wallets where company_id=$1",
        [company],
      ),
    ).toBe("0.000000");
    await db.exec(
      "update system_settings set value='\"live\"'::jsonb where key='data_mode'",
    );
  });
});
