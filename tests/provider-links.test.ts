import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";

const db = new PGlite();
const admin = crypto.randomUUID(),
  customer = crypto.randomUUID(),
  other = crypto.randomUUID();
const provider = crypto.randomUUID(),
  secondProvider = crypto.randomUUID(),
  upstream = crypto.randomUUID(),
  device = crypto.randomUUID();
const effective = "2026-11-01T00:00:00Z";
let company: string, otherCompany: string;
async function scalar<T = string>(
  query: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(query, params);
  return Object.values(result.rows[0])[0];
}
async function claims(user = admin, role = "authenticated") {
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: user, role, aal: "aal1" }),
  ]);
}
async function importCall(
  key: string,
  direction = "outbound",
  options: {
    account?: string;
    time?: string;
    localUser?: string;
    remoteUser?: string;
    identity?: string | null;
  } = {},
) {
  await claims(admin, "service_role");
  const local = {
    number: "93534179",
    user_id: options.localUser ?? "58017",
    cid: options.identity ?? "493046690243",
  };
  const remote = {
    number: "4917600000000",
    user_id: options.remoteUser ?? null,
  };
  return scalar(
    "select import_call($1,$2,'93534179','4917600000000',$3,$3,0,$4,'cancel',0,$5,$6)",
    [
      options.account ?? provider,
      key,
      options.time ?? "2026-11-03T09:00:00Z",
      direction,
      JSON.stringify(
        direction === "inbound"
          ? { caller: remote, callee: local }
          : { caller: local, callee: remote },
      ),
      direction === "inbound"
        ? "93534179"
        : (options.identity ?? "493046690243"),
    ],
  );
}
async function link(backfill = true, user = customer) {
  await claims();
  return scalar<{ linked_calls: number; linked_devices: number }>(
    "select link_provider_user($1,$2,$3,$4)",
    [upstream, user, effective, backfill],
  );
}
beforeAll(async () => {
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,'admin@example.invalid')",
    [admin],
  );
  await db.query(
    "update profiles set platform_role='super_admin' where id=$1",
    [admin],
  );
  for (const [id, email, name] of [
    [customer, "customer@example.invalid", "Customer"],
    [other, "other@example.invalid", "Other"],
  ])
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [
        id,
        email,
        JSON.stringify({
          registration_company_name: name,
          registration_currency: "EUR",
        }),
      ],
    );
  company = await scalar(
    "select company_id from company_memberships where user_id=$1",
    [customer],
  );
  otherCompany = await scalar(
    "select company_id from company_memberships where user_id=$1",
    [other],
  );
  await db.query(
    "insert into provider_accounts(id,name,currency) values($1,'First','EUR'),($2,'Second','EUR')",
    [provider, secondProvider],
  );
  await db.query(
    "insert into provider_users(id,provider_account_id,provider_resource_id,raw) values($1,$2,'58017','{\"email\":\"customer@example.invalid\"}'),($3,$4,'58017','{\"email\":\"other@example.invalid\"}')",
    [upstream, provider, crypto.randomUUID(), secondProvider],
  );
  await db.query(
    "insert into provider_devices(id,provider_account_id,provider_resource_id,provider_user_resource_id) values($1,$2,'93534179','58017')",
    [device, provider],
  );
  await db.exec("begin");
  await importCall("outbound");
  await importCall("inbound", "inbound");
  await importCall("before-window", "outbound", {
    time: "2026-10-01T00:00:00Z",
  });
  await importCall("other-upstream-user", "outbound", { localUser: "58018" });
  await importCall("other-provider", "outbound", { account: secondProvider });
  const assigned = await importCall("already-assigned");
  await db.query("update calls set company_id=$1,user_id=$2 where id=$3", [
    otherCompany,
    other,
    assigned,
  ]);
  const charged = await importCall("already-charged");
  await db.query("update calls set billing_status='charged' where id=$1", [
    charged,
  ]);
  await db.exec("commit");
});
beforeEach(async () => {
  await db.exec("begin");
  await claims();
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db.close();
});

describe("verified provider user links", () => {
  it("backfills only unowned, uncharged calls for the exact account, local user, and time window", async () => {
    expect(await link()).toMatchObject({ linked_calls: 2, linked_devices: 1 });
    expect(
      await scalar<number>(
        "select count(*)::int from calls where company_id=$1 and user_id=$2",
        [company, customer],
      ),
    ).toBe(2);
    expect(
      await scalar(
        "select application_user_id from provider_devices where id=$1",
        [device],
      ),
    ).toBe(customer);
    expect(
      await scalar(
        "select company_id from calls where provider_resource_id='already-assigned'",
      ),
    ).toBe(otherCompany);
    expect(
      await scalar<number>(
        "select count(*)::int from calls where provider_resource_id in ('before-window','other-provider','other-upstream-user','already-charged') and company_id is null",
      ),
    ).toBe(4);
    expect(
      await scalar<number>(
        "select count(*)::int from billing_exceptions where status='resolved'",
      ),
    ).toBe(2);
    expect(
      await scalar<number>(
        "select count(*)::int from calls where customer_charge is not null",
      ),
    ).toBe(0);
    expect((await link()).linked_calls).toBe(0);
  });
  it("attributes future incoming device calls and outgoing calls through the verified link", async () => {
    await link(false);
    const incoming = await importCall("future-inbound", "inbound");
    const outgoing = await importCall("future-outbound");
    expect(
      await scalar<number>(
        "select count(*)::int from calls where id in ($1,$2) and company_id=$3 and user_id=$4",
        [incoming, outgoing, company, customer],
      ),
    ).toBe(2);
    await importCall("future-outbound", "outbound", { localUser: "58018" });
    expect(
      await scalar("select user_id from calls where id=$1", [outgoing]),
    ).toBe(customer);
  });
  it("does not use the remote caller or recipient's user identity", async () => {
    await link(false);
    const outbound = await importCall("remote-outbound", "outbound", {
      localUser: "58018",
      remoteUser: "58017",
    });
    const inbound = await importCall("remote-inbound", "inbound", {
      localUser: "58018",
      remoteUser: "58017",
    });
    expect(
      await scalar<number>(
        "select count(*)::int from calls where id in ($1,$2) and company_id is null",
        [outbound, inbound],
      ),
    ).toBe(2);
  });
  it("rejects an email mismatch without linking devices or calls", async () => {
    await expect(link(true, other)).rejects.toThrow(/PROVIDER_EMAIL_MISMATCH/);
  });
  it("enforces the effective end time and refuses conflicting DID ownership", async () => {
    await link(false);
    const did = crypto.randomUUID();
    await db.query(
      "insert into did_numbers(id,provider_account_id,provider_resource_id,number) values($1,$2,'conflict','493046690243')",
      [did, provider],
    );
    await db.query(
      "insert into did_allocations(did_id,company_id,user_id,valid_from) values($1,$2,$3,$4)",
      [did, otherCompany, other, effective],
    );
    const conflict = await importCall("conflict");
    expect(
      await scalar("select company_id from calls where id=$1", [conflict]),
    ).toBeNull();
    expect(
      await scalar("select code from billing_exceptions where call_id=$1", [
        conflict,
      ]),
    ).toBe("OWNERSHIP_CONFLICT");
    await db.exec(
      "update provider_user_links set valid_to='2026-11-05T00:00:00Z'",
    );
    const expired = await importCall("expired", "inbound", {
      time: "2026-11-06T00:00:00Z",
    });
    expect(
      await scalar("select company_id from calls where id=$1", [expired]),
    ).toBeNull();
  });
  it("preserves tenant isolation and denies customer access to wholesale prices and linking", async () => {
    await link();
    await claims(customer);
    await db.exec("set local role authenticated");
    expect(await scalar<number>("select count(*)::int from calls")).toBe(2);
    expect(
      await scalar<number>(
        "select count(*)::int from calls where company_id=$1",
        [otherCompany],
      ),
    ).toBe(0);
    await expect(db.query("select provider_cost from calls")).rejects.toThrow(
      /permission denied/,
    );
  });
  it("allows an allocated number to have an explicitly unconfigured retail price", async () => {
    const did = crypto.randomUUID();
    await db.query(
      "insert into did_numbers(id,provider_account_id,provider_resource_id,number) values($1,$2,'unpriced','493046690243')",
      [did, provider],
    );
    const allocation = await scalar("select allocate_did($1,$2,$3,null)", [
      did,
      company,
      customer,
    ]);
    expect(
      await scalar("select monthly_price from did_allocations where id=$1", [
        allocation,
      ]),
    ).toBeNull();
  });
  it("denies linking to a customer session", async () => {
    await claims(customer);
    await expect(
      db.query("select link_provider_user($1,$2,$3,true)", [
        upstream,
        customer,
        effective,
      ]),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
