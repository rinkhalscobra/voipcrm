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
import { homeFor, canReadSnapshot } from "../src/lib/auth/permissions";
import type { UserContext } from "../src/lib/types";

const db = new PGlite();
const admin = crypto.randomUUID(),
  first = crypto.randomUUID(),
  second = crypto.randomUUID();
const provider = crypto.randomUUID();
let company: string, company2: string, company3: string, clientId: string;
async function scalar<T = string>(
  query: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(query, params);
  return Object.values(result.rows[0])[0];
}
async function session(user = admin) {
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: user, role: "authenticated", aal: "aal1" }),
  ]);
}
beforeAll(async () => {
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
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
  await session();
  company = await scalar(
    "select create_company('Hinvest Berlin','hinvest-berlin',null,null,'EUR')",
  );
  company2 = await scalar(
    "select create_company('Company 2','company-2',null,null,'EUR')",
  );
  company3 = await scalar(
    "select create_company('Company 3','company-3',null,null,'EUR')",
  );
  for (const [user, name, email] of [
    [first, "Client1", "client1@example.invalid"],
    [second, "Client2", "client2@example.invalid"],
  ]) {
    const invitation = await scalar(
      "insert into user_invitations(company_id,email,role,invited_by) values($1,$2,'client',$3) returning id",
      [company, email, admin],
    );
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [
        user,
        email,
        JSON.stringify({ full_name: name, invitation_id: invitation }),
      ],
    );
  }
  clientId = await scalar("select id from clients where user_id=$1", [first]);
  await db.query(
    "insert into provider_accounts(id,name,currency,company_id) values($1,'Provider','EUR',$2)",
    [provider, company],
  );
  for (const [index, user] of [first, second].entries()) {
    const did = await scalar(
      "insert into did_numbers(provider_account_id,provider_resource_id,number) values($1,$2,$3) returning id",
      [provider, `did-${index}`, `49300000000${index}`],
    );
    await db.query("select allocate_did($1,$2,$3,null)", [did, company, user]);
    await db.query(
      "insert into calls(provider_account_id,provider_resource_id,company_id,user_id,started_at,direction,status,provider_cost,currency) values($1,$2,$3,$4,now(),'outbound','answer',0.1,'EUR')",
      [provider, `call-${index}`, company, user],
    );
  }
  await db.exec("commit");
});
beforeEach(async () => {
  await db.exec("begin");
  await session();
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db.close();
});

describe("companies and their clients", () => {
  it("restricts Auth email conflict checks to the service role", async () => {
    expect(
      await scalar<boolean>(
        "select has_function_privilege('authenticated','public.client_email_in_use(text,uuid)','execute')",
      ),
    ).toBe(false);
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    expect(
      await scalar<boolean>("select client_email_in_use($1,$2)", [
        "CLIENT2@EXAMPLE.INVALID",
        first,
      ]),
    ).toBe(true);
    expect(
      await scalar<boolean>("select client_email_in_use($1,$2)", [
        "client1@example.invalid",
        first,
      ]),
    ).toBe(false);
  });
  it("creates company containers without automatically creating a client", async () => {
    expect(await scalar<number>("select count(*)::int from companies")).toBe(3);
    for (const id of [company2, company3]) {
      expect(
        (await scalar<{ total: number }>("select list_clients($1)", [id]))
          .total,
      ).toBe(0);
      expect(
        await scalar<number>(
          "select count(*)::int from company_memberships where company_id=$1",
          [id],
        ),
      ).toBe(0);
      expect(
        await scalar<number>(
          "select count(*)::int from did_allocations where company_id=$1",
          [id],
        ),
      ).toBe(0);
    }
  });
  it("creates a separate named client entity and a restricted membership from an invitation", async () => {
    const clients = await scalar<{
      rows: { name: string; email: string; numbers: string[] }[];
      total: number;
    }>("select list_clients($1)", [company]);
    expect(clients.total).toBe(2);
    expect(
      clients.rows.find((row) => row.email === "client1@example.invalid"),
    ).toMatchObject({
      name: "Client1",
      email: "client1@example.invalid",
      numbers: ["493000000000"],
    });
    expect(
      await scalar("select role from company_memberships where user_id=$1", [
        first,
      ]),
    ).toBe("client");
    await session(first);
    const context = await scalar<UserContext>("select my_context()");
    expect(context.client).toMatchObject({
      name: "Client1",
      company_name: "Hinvest Berlin",
    });
    expect(homeFor(context)).toBe("/client");
    expect(context.permissions).not.toContain("users.manage");
    expect(context.permissions).not.toContain("finance.read");
    expect(
      canReadSnapshot(context, {
        company_id: company,
        user_id: second,
        manager_id: null,
        team_leader_id: null,
      }),
    ).toBe(false);
  });
  it("restricts clients to their own calls and number even within the same company", async () => {
    await session(first);
    await db.exec("set local role authenticated");
    expect(await scalar<number>("select count(*)::int from calls")).toBe(1);
    expect(
      await scalar<number>("select count(*)::int from calls where user_id=$1", [
        second,
      ]),
    ).toBe(0);
    expect(await scalar<number>("select count(*)::int from my_numbers()")).toBe(
      1,
    );
    expect(await scalar<number>("select count(*)::int from clients")).toBe(1);
    expect(
      await scalar<number>("select count(*)::int from customer_wallets"),
    ).toBe(0);
    expect(
      (
        await scalar<{ total: number }>(
          "select export_calls('1970-01-01','2100-01-01')",
        )
      ).total,
    ).toBe(1);
  });
  it("renames the client independently of its company and preserves its owned data", async () => {
    await db.query("select update_client($1,'Renamed client',true)", [
      clientId,
    ]);
    expect(
      await scalar("select name from clients where id=$1", [clientId]),
    ).toBe("Renamed client");
    expect(
      await scalar("select full_name from profiles where id=$1", [first]),
    ).toBe("Renamed client");
    expect(
      await scalar(
        "select raw_user_meta_data->>'full_name' from auth.users where id=$1",
        [first],
      ),
    ).toBe("Renamed client");
    expect(
      await scalar("select name from companies where id=$1", [company]),
    ).toBe("Hinvest Berlin");
    expect(
      await scalar<number>(
        "select count(*)::int from calls where user_id=$1 and company_id=$2",
        [first, company],
      ),
    ).toBe(1);
  });
  it("commits admin Auth changes, profile details, and an audit event together", async () => {
    const marker = {
      id: crypto.randomUUID(),
      actor_id: admin,
      client_id: clientId,
      name: "Updated client",
      email: "updated@example.invalid",
      email_changed: true,
      active: true,
      password_changed: true,
    };
    // Mirror GoTrue's order: email, app metadata, then user metadata, all in
    // the surrounding transaction. full_name is still old at the app step.
    await db.query("update auth.users set email=$2 where id=$1", [
      first,
      marker.email,
    ]);
    await db.query("update auth.users set raw_app_meta_data=$2 where id=$1", [
      first,
      JSON.stringify({ voixel_client_edit: marker }),
    ]);
    await db.query(
      "update auth.users set raw_user_meta_data=raw_user_meta_data||$2::jsonb where id=$1",
      [first, JSON.stringify({ full_name: marker.name })],
    );
    expect(
      await scalar("select name from clients where id=$1", [clientId]),
    ).toBe(marker.name);
    expect(
      await scalar("select full_name from profiles where id=$1", [first]),
    ).toBe(marker.name);
    expect(
      await scalar<boolean>("select suspended from profiles where id=$1", [
        first,
      ]),
    ).toBe(false);
    const listed = await scalar<{ rows: { email: string }[] }>(
      "select list_clients($1)",
      [company],
    );
    expect(listed.rows.some((c) => c.email === marker.email)).toBe(true);
    expect(
      await scalar<number>(
        "select count(*)::int from calls where user_id=$1 and company_id=$2",
        [first, company],
      ),
    ).toBe(1);
    expect(
      await scalar<string>(
        "select balance::text from client_wallets where client_id=$1",
        [clientId],
      ),
    ).toBe("0.000000");
    const audit = await scalar<Record<string, unknown>>(
      "select metadata from audit_logs where resource_id=$1 and action='client.account_updated'",
      [clientId],
    );
    expect(audit).toMatchObject({
      name: marker.name,
      active: true,
      email_changed: true,
      password_changed: true,
    });
    expect(Object.keys(audit)).not.toContain("password");
    // Auth may save the same user more than once in a transaction.
    await db.query("update auth.users set email=email where id=$1", [first]);
    expect(
      await scalar<number>(
        "select count(*)::int from audit_logs where resource_id=$1 and action='client.account_updated'",
        [clientId],
      ),
    ).toBe(1);
  });
  it("suspends existing client sessions and allows an administrator to reactivate them", async () => {
    for (const active of [false, true]) {
      const marker = {
        id: crypto.randomUUID(),
        actor_id: admin,
        client_id: clientId,
        name: "Client1",
        email: "client1@example.invalid",
        email_changed: false,
        active,
        password_changed: false,
      };
      await db.query("update auth.users set raw_app_meta_data=$2 where id=$1", [
        first,
        JSON.stringify({ voixel_client_edit: marker }),
      ]);
      expect(
        await scalar<boolean>(
          "select active from company_memberships where user_id=$1",
          [first],
        ),
      ).toBe(active);
      expect(
        await scalar<boolean>("select suspended from profiles where id=$1", [
          first,
        ]),
      ).toBe(!active);
      await session(first);
      expect(Boolean(await scalar("select my_context()"))).toBe(active);
      await session();
    }
  });
  it("does not treat user-editable metadata as permission to change account status", async () => {
    await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [
      first,
      JSON.stringify({
        full_name: "Forged",
        voixel_client_edit: {
          actor_id: admin,
          active: false,
          client_id: clientId,
        },
      }),
    ]);
    expect(
      await scalar("select name from clients where id=$1", [clientId]),
    ).toBe("Client1");
    expect(
      await scalar<boolean>(
        "select active from company_memberships where user_id=$1",
        [first],
      ),
    ).toBe(true);
  });
  it("rejects an Auth operation attributed to an unauthorized client", async () => {
    const marker = {
      id: crypto.randomUUID(),
      actor_id: first,
      client_id: clientId,
      name: "Forged",
      email: "client1@example.invalid",
      email_changed: false,
      active: false,
      password_changed: false,
    };
    await expect(
      db.query("update auth.users set raw_app_meta_data=$2 where id=$1", [
        first,
        JSON.stringify({ voixel_client_edit: marker }),
      ]),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("rolls back the Auth email when the profile operation is invalid", async () => {
    await db.exec("savepoint invalid_account");
    const marker = {
      id: crypto.randomUUID(),
      actor_id: admin,
      client_id: clientId,
      name: "Changed",
      email: "different@example.invalid",
      email_changed: true,
      active: true,
      password_changed: false,
    };
    await expect(
      db.query(
        "update auth.users set email='attempt@example.invalid',raw_user_meta_data=$2,raw_app_meta_data=$3 where id=$1",
        [
          first,
          JSON.stringify({ full_name: "Changed" }),
          JSON.stringify({ voixel_client_edit: marker }),
        ],
      ),
    ).rejects.toThrow(/INVALID_REQUEST/);
    await db.exec("rollback to savepoint invalid_account");
    expect(
      await scalar("select email from auth.users where id=$1", [first]),
    ).toBe("client1@example.invalid");
    expect(
      await scalar("select name from clients where id=$1", [clientId]),
    ).toBe("Client1");
  });
  it("suspends a client without deleting the company, number, or historical calls", async () => {
    await db.query("select update_client($1,'Client1',false)", [clientId]);
    expect(
      await scalar<number>("select count(*)::int from calls where user_id=$1", [
        first,
      ]),
    ).toBe(1);
    await session(first);
    await db.exec("set local role authenticated");
    expect(await scalar<number>("select count(*)::int from calls")).toBe(0);
  });
  it("denies client enumeration and client-management RPCs to client logins", async () => {
    await session(first);
    await expect(
      db.query("select list_clients($1)", [company]),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("denies a client's attempt to rename another client", async () => {
    await session(first);
    await expect(
      db.query("select update_client($1,'Unauthorized',true)", [clientId]),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("prevents a client record from becoming company staff", async () => {
    await expect(
      db.query(
        "update company_memberships set role='company_admin' where user_id=$1",
        [first],
      ),
    ).rejects.toThrow(/CLIENT_ROLE_MISMATCH/);
  });
  it("lets an administrator assign a number to an independent client email and preserves prior call ownership", async () => {
    const did = await scalar(
      "select id from did_numbers where provider_resource_id='did-0'",
    );
    const target = await scalar("select id from clients where user_id=$1", [
      second,
    ]);
    await db.query("select assign_number_client($1,$2)", [did, target]);
    expect(
      await scalar(
        "select user_id from did_allocations where did_id=$1 and valid_to is null",
        [did],
      ),
    ).toBe(second);
    expect(
      await scalar(
        "select user_id from calls where provider_resource_id='call-0'",
      ),
    ).toBe(first);
    expect(
      await scalar("select email from auth.users where id=$1", [second]),
    ).toBe("client2@example.invalid");
  });
  it("uses inbound caller.dnid to separate clients sharing one company TelTel user and device", async () => {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: admin, role: "service_role", aal: "aal1" }),
    ]);
    for (const index of [0, 1]) {
      await db.query(
        "select import_call($1,$2,'remote','93534179',now()+interval '1 second',now()+interval '2 seconds',1,'inbound','answer',0.1,$3,'93534179')",
        [
          provider,
          `inbound-${index}`,
          JSON.stringify({
            caller: { dnid: `49300000000${index}`, number: "remote" },
            callee: { number: "93534179", user_id: "shared-company-user" },
          }),
        ],
      );
    }
    expect(
      await scalar(
        "select user_id from calls where provider_resource_id='inbound-0'",
      ),
    ).toBe(first);
    expect(
      await scalar(
        "select user_id from calls where provider_resource_id='inbound-1'",
      ),
    ).toBe(second);
    const otherCall = await scalar(
      "select id from calls where provider_resource_id='inbound-1'",
    );
    await session(first);
    await db.exec("set local role authenticated");
    expect(
      await scalar<number>("select count(*)::int from calls where id=$1", [
        otherCall,
      ]),
    ).toBe(0);
  });
  it("shows unassigned company inventory without giving its calls to any client", async () => {
    await db.query(
      "insert into did_numbers(provider_account_id,provider_resource_id,number) values($1,'unassigned','493000000009')",
      [provider],
    );
    const inventory = await scalar<{
      total: number;
      rows: Record<string, unknown>[];
    }>("select company_numbers($1)", [company]);
    expect(inventory.total).toBe(3);
    expect(
      inventory.rows.every(
        (row) => !("wholesale_monthly" in row) && !("raw" in row),
      ),
    ).toBe(true);
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: admin, role: "service_role", aal: "aal1" }),
    ]);
    await db.query(
      "select import_call($1,'unassigned',null,null,now(),now(),0,'inbound','cancel',0,$2,'93534179')",
      [
        provider,
        JSON.stringify({
          caller: { dnid: "493000000009" },
          callee: { user_id: "shared-company-user", number: "93534179" },
        }),
      ],
    );
    expect(
      await scalar(
        "select company_id from calls where provider_resource_id='unassigned'",
      ),
    ).toBe(company);
    expect(
      await scalar(
        "select user_id from calls where provider_resource_id='unassigned'",
      ),
    ).toBeNull();
    const unassignedCall = await scalar(
      "select id from calls where provider_resource_id='unassigned'",
    );
    await session(first);
    await db.exec("set local role authenticated");
    expect(
      await scalar<number>("select count(*)::int from calls where id=$1", [
        unassignedCall,
      ]),
    ).toBe(0);
  });
  it("prevents matching email from linking a whole company TelTel account to a client", async () => {
    const upstream = await scalar(
      "insert into provider_users(provider_account_id,provider_resource_id,raw) values($1,'company-account','{\"email\":\"client1@example.invalid\"}') returning id",
      [provider],
    );
    await expect(
      db.query("select link_provider_user($1,$2,now(),false)", [
        upstream,
        first,
      ]),
    ).rejects.toThrow(/CLIENT_NUMBER_ASSIGNMENT_REQUIRED/);
  });
  it("denies a client's attempt to change its own number assignment", async () => {
    const did = await scalar(
      "select id from did_numbers where provider_resource_id='did-0'",
    );
    await session(first);
    await expect(
      db.query("select assign_number_client($1,$2)", [did, clientId]),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it("rejects a client from a different company", async () => {
    const other = crypto.randomUUID();
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'other-client@example.invalid','{\"full_name\":\"Other client\"}')",
      [other],
    );
    await db.query(
      "insert into company_memberships(company_id,user_id,role) values($1,$2,'client')",
      [company2, other],
    );
    const target = await scalar("select id from clients where user_id=$1", [
      other,
    ]);
    const did = await scalar(
      "select id from did_numbers where provider_resource_id='did-0'",
    );
    await expect(
      db.query("select assign_number_client($1,$2)", [did, target]),
    ).rejects.toThrow(/CLIENT_COMPANY_MISMATCH/);
  });
  it("can remove a client assignment while retaining company inventory and historical client data", async () => {
    const did = await scalar(
      "select id from did_numbers where provider_resource_id='did-0'",
    );
    await db.query("select assign_number_client($1,null)", [did]);
    expect(
      await scalar(
        "select user_id from did_allocations where did_id=$1 and valid_to is null",
        [did],
      ),
    ).toBeNull();
    expect(
      await scalar(
        "select user_id from calls where provider_resource_id='call-0'",
      ),
    ).toBe(first);
    expect(
      (await scalar<{ total: number }>("select company_numbers($1)", [company]))
        .total,
    ).toBe(2);
    await session(first);
    await db.exec("set local role authenticated");
    expect(await scalar<number>("select count(*)::int from my_numbers()")).toBe(
      0,
    );
  });
});
