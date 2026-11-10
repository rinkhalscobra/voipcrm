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
import { formatCredit } from "../src/lib/utils";

const db = new PGlite();
const admin = crypto.randomUUID(),
  first = crypto.randomUUID(),
  second = crypto.randomUUID(),
  provider = crypto.randomUUID();
let company: string, client: string, otherClient: string, wallet: string;
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
async function credit(
  amount = "500",
  key = crypto.randomUUID(),
  type = "credit",
) {
  await claims();
  return scalar<{ balance: number; replayed: boolean }>(
    "select adjust_client_balance($1,$2,$3,$4,'Test client credit')",
    [client, type, amount, key],
  );
}
async function process() {
  await claims(admin, "service_role");
  return scalar<{ processed: number }>("select process_client_billing(100)");
}
async function call(
  seconds = 3600,
  options: {
    key?: string;
    user?: string;
    direction?: string;
    status?: string;
    destination?: string;
    duration?: number;
    start?: string;
    end?: string | null;
    handle?: unknown;
  } = {},
) {
  const key = options.key ?? crypto.randomUUID();
  const start = options.start ?? "2026-11-09T10:00:00Z";
  const duration = options.duration ?? seconds;
  const end =
    options.end === undefined
      ? new Date(new Date(start).getTime() + duration * 1000).toISOString()
      : options.end;
  const id = await scalar(
    "insert into calls(provider_account_id,provider_resource_id,company_id,user_id,started_at,ended_at,duration_seconds,direction,status,destination,currency,provider_cost) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'EUR',9.9) returning id",
    [
      provider,
      key,
      company,
      options.user ?? first,
      start,
      end,
      duration,
      options.direction ?? "outbound",
      options.status ?? "answer",
      options.destination ?? "4917600000000",
    ],
  );
  await db.query(
    "insert into private.call_payloads(call_id,raw) values($1,$2)",
    [
      id,
      JSON.stringify({
        handle_sec: options.handle === undefined ? seconds : options.handle,
        waiting_sec: 30,
      }),
    ],
  );
  return id;
}
async function correct(id: string, seconds: number, status = "answer") {
  await db.query(
    "update calls set duration_seconds=$2::integer,ended_at=started_at+make_interval(secs=>$2::integer),status=$3 where id=$1",
    [id, seconds, status],
  );
  await db.query(
    "update private.call_payloads set raw=jsonb_build_object('handle_sec',$2::integer) where call_id=$1",
    [id, seconds],
  );
}
beforeAll(async () => {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`,
  );
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
  await db.exec("begin");
  await claims();
  company = await scalar(
    "select create_company('Company','company','company@example.invalid','Germany','EUR')",
  );
  for (const [id, email] of [
    [first, "client1@example.invalid"],
    [second, "client2@example.invalid"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      email,
    ]);
    await db.query("update profiles set full_name='Client' where id=$1", [id]);
    await db.query(
      "insert into company_memberships(company_id,user_id,role) values($1,$2,'client')",
      [company, id],
    );
  }
  client = await scalar("select id from clients where user_id=$1", [first]);
  otherClient = await scalar("select id from clients where user_id=$1", [
    second,
  ]);
  wallet = await scalar("select id from client_wallets where client_id=$1", [
    client,
  ]);
  // Test calls are completed historical fixtures; production cutoff stays at activation time.
  await db.exec(
    "update client_wallets set billing_from='2026-01-01T00:00:00Z'",
  );
  await db.query(
    "insert into client_rates(client_id,company_id,currency,per_minute,valid_from) values($1,$3,'EUR',0.0442,'2026-01-01'),($2,$3,'EUR',0.0442,'2026-01-01')",
    [client, otherClient, company],
  );
  await db.query(
    "insert into provider_accounts(id,name,currency,balance,company_id) values($1,'Wholesale','EUR',9999,$2)",
    [provider, company],
  );
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

describe("independent client credit and Germany usage", () => {
  it("deducts exactly EUR 2.652 for one talk hour from EUR 500, without touching provider or company funds", async () => {
    await credit();
    const id = await call();
    expect((await process()).processed).toBe(1);
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("497.348000");
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [id]),
    ).toBe("2.652000");
    expect(
      await scalar("select balance::text from provider_accounts where id=$1", [
        provider,
      ]),
    ).toBe("9999.000000");
    expect(
      await scalar(
        "select balance::text from customer_wallets where company_id=$1",
        [company],
      ),
    ).toBe("0.000000");
    expect(
      await scalar(
        "select balance::text from client_wallets where client_id=$1",
        [otherClient],
      ),
    ).toBe("0.000000");
    expect(formatCredit("497.348", "EUR")).toBe("€497.348");
  });
  it("uses talk seconds, excluding ringing and waiting time", async () => {
    await credit();
    const id = await call(60, { duration: 90 });
    await process();
    expect(
      await scalar("select talk_seconds from calls where id=$1", [id]),
    ).toBe(60);
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [id]),
    ).toBe("0.044200");
  });
  it("prorates partial minutes and rounds each call to six decimal places", async () => {
    await credit();
    const half = await call(30),
      one = await call(1);
    await process();
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [
        half,
      ]),
    ).toBe("0.022100");
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [
        one,
      ]),
    ).toBe("0.000737");
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("499.977163");
  });
  it("never charges the same call twice when processing is retried", async () => {
    await credit();
    await call(60);
    await process();
    for (let i = 0; i < 5; i++) expect((await process()).processed).toBe(0);
    expect(
      await scalar<number>(
        "select count(*)::int from client_wallet_entries where type='call_charge'",
      ),
    ).toBe(1);
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("499.955800");
  });
  it("charges only the difference when provider talk duration increases", async () => {
    await credit();
    const id = await call(60);
    await process();
    await correct(id, 120);
    await process();
    await process();
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("499.911600");
    expect(
      await scalar<number>(
        "select count(*)::int from client_call_ratings where call_id=$1",
        [id],
      ),
    ).toBe(2);
  });
  it("appends a refund when provider talk duration decreases", async () => {
    await credit();
    const id = await call(60);
    await process();
    await correct(id, 30);
    await process();
    await process();
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("499.977900");
    expect(
      await scalar<number>(
        "select count(*)::int from client_wallet_entries where type='call_refund'",
      ),
    ).toBe(1);
  });
  it("refunds a later-cancelled call while preserving its original rating", async () => {
    await credit();
    const id = await call(60);
    await process();
    await correct(id, 0, "cancel");
    await process();
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
    expect(
      await scalar(
        "select amount::text from client_call_ratings where call_id=$1 and revision=1",
        [id],
      ),
    ).toBe("0.044200");
  });
  it("keeps zero credit non-negative and settles unpaid usage when the admin adds credit", async () => {
    const id = await call();
    await process();
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("0.000000");
    expect(
      await scalar("select billing_status from calls where id=$1", [id]),
    ).toBe("pending_credit");
    await credit("1");
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("0.000000");
    const pending = await scalar<{ wallets: { pending_usage: number }[] }>(
      "select client_balance_overview($1)",
      [client],
    );
    expect(pending.wallets[0].pending_usage).toBe(1.652);
    await credit("3");
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("1.348000");
    expect(
      await scalar("select billing_status from calls where id=$1", [id]),
    ).toBe("charged");
  });
  it("sets an exact available balance and makes retries idempotent", async () => {
    const key = crypto.randomUUID();
    await credit("500", key, "set");
    await call();
    await process();
    expect((await credit("500", key, "set")).replayed).toBe(true);
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("497.348000");
    await credit("500", crypto.randomUUID(), "set");
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
  });
  it("sets available credit after covering previously unpaid usage", async () => {
    await call();
    await process();
    await credit("500", crypto.randomUUID(), "set");
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
    const overview = await scalar<{ wallets: { pending_usage: number }[] }>(
      "select client_balance_overview($1)",
      [client],
    );
    expect(overview.wallets[0].pending_usage).toBe(0);
  });
  it("rejects reuse of a funding key for a different amount", async () => {
    const key = crypto.randomUUID();
    await credit("500", key);
    await expect(credit("600", key)).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });
  it("leaves incoming, unanswered, and unpriced destinations uncharged", async () => {
    await credit();
    const inbound = await call(60, { direction: "inbound" }),
      busy = await call(0, { status: "busy" }),
      foreign = await call(60, { destination: "33123456789" });
    await process();
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [
        inbound,
      ]),
    ).toBe("0.000000");
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [
        busy,
      ]),
    ).toBe("0.000000");
    expect(
      await scalar("select customer_charge from calls where id=$1", [foreign]),
    ).toBeNull();
  });
  it("does not charge any pre-activation history", async () => {
    await db.query(
      "update client_wallets set billing_from=clock_timestamp() where id=$1",
      [wallet],
    );
    await credit();
    const id = await call();
    await process();
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
    expect(
      await scalar("select customer_charge from calls where id=$1", [id]),
    ).toBeNull();
    expect(
      await scalar("select billing_status from calls where id=$1", [id]),
    ).toBe("before_billing_start");
  });
  it("waits for completion and never substitutes ringing time for invalid talk data", async () => {
    await credit();
    await call(60, { end: null });
    await call(60, { handle: "invalid" });
    await process();
    expect(
      await scalar<number>("select count(*)::int from client_call_ratings"),
    ).toBe(0);
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
  });
  it("keeps captured prices when the provider later corrects a call", async () => {
    await credit();
    const id = await call(60);
    await process();
    await db.query(
      "insert into client_rates(client_id,company_id,currency,per_minute,valid_from) values($1,$2,'EUR',0.1,'2026-11-01')",
      [client, company],
    );
    await correct(id, 120);
    await process();
    expect(
      await scalar("select customer_charge::text from calls where id=$1", [id]),
    ).toBe("0.088400");
  });
  it("lets a client read only its own balance and ledger, without TelTel funds", async () => {
    await credit();
    await claims();
    await db.query(
      "select adjust_client_balance($1,'credit',200,$2,'Other client')",
      [otherClient, crypto.randomUUID()],
    );
    await claims(first);
    await db.exec("set local role authenticated");
    const own = await scalar<{
      wallets: { client_id: string; balance: number }[];
      transactions: unknown[];
    }>("select client_balance_overview()");
    expect(own.wallets).toHaveLength(1);
    expect(own.wallets[0]).toMatchObject({ client_id: client, balance: 500 });
    expect(own.transactions).toHaveLength(1);
    expect(
      (
        await scalar<{ wallets: unknown[] }>(
          "select client_balance_overview($1)",
          [otherClient],
        )
      ).wallets,
    ).toEqual([]);
    await expect(db.query("select * from provider_accounts")).rejects.toThrow(
      /permission denied/,
    );
  });
  it("denies client funding, retail-rate changes, and billing execution", async () => {
    await claims(first);
    await expect(
      db.query(
        "select adjust_client_balance($1,'credit',500,$2,'Unauthorized')",
        [client, crypto.randomUUID()],
      ),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("denies a client changing its retail rate", async () => {
    await claims(first);
    await expect(
      db.query("select set_client_germany_rate($1,0)", [client]),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("denies a client executing automatic billing", async () => {
    await claims(first);
    await expect(
      db.query("select process_client_billing(100)"),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("denies direct balance edits even for the client who owns it", async () => {
    await claims(first);
    await db.exec("set local role authenticated");
    await expect(
      db.query("update client_wallets set balance=500 where client_id=$1", [
        client,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
  it("keeps client credit unchanged when the TelTel balance or wholesale cost changes", async () => {
    await credit();
    const id = await call(60);
    await process();
    await db.query("update provider_accounts set balance=1 where id=$1", [
      provider,
    ]);
    await db.query("update calls set provider_cost=999 where id=$1", [id]);
    expect((await process()).processed).toBe(0);
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("499.955800");
  });
  it("serializes repeated concurrent credit requests with the same key", async () => {
    const key = crypto.randomUUID();
    await Promise.all([credit("500", key), credit("500", key)]);
    expect(
      await scalar("select balance::text from client_wallets where id=$1", [
        wallet,
      ]),
    ).toBe("500.000000");
    expect(
      await scalar<number>(
        "select count(*)::int from client_wallet_entries where type='credit'",
      ),
    ).toBe(1);
  });
  it("prevents legacy company billing from charging a client call again", async () => {
    const id = await call(60);
    await claims();
    await expect(
      db.query("select rate_call($1,$2)", [id, crypto.randomUUID()]),
    ).rejects.toThrow(/CLIENT_BILLING_MANAGED/);
  });
  it("protects the credit ledger from edits", async () => {
    await credit();
    await expect(
      db.exec("update client_wallet_entries set amount=999"),
    ).rejects.toThrow(/IMMUTABLE_RECORD/);
  });
});
