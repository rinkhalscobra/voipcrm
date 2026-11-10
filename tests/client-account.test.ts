import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContext } from "../src/lib/types";
import { clientAccountSchema } from "../src/lib/auth/client-account-schema";
vi.mock("server-only", () => ({}));
import { updateClientAccount } from "../src/lib/auth/client-account";

const context: UserContext = {
  id: crypto.randomUUID(),
  full_name: "Admin",
  platform_role: "super_admin",
  suspended: false,
  permissions: [],
  membership: null,
};
const clientId = crypto.randomUUID(),
  userId = crypto.randomUUID();
const input = {
  name: "Client1",
  email: "client@example.invalid",
  active: true,
};
function service(
  options: {
    seed?: boolean;
    missing?: boolean;
    code?: string;
    emailInUse?: boolean;
  } = {},
) {
  const user = {
    id: userId,
    email: "old@example.invalid",
    user_metadata: { full_name: "Old", preserved: "value" },
    app_metadata: { provider: "email" },
  };
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.missing
      ? null
      : { id: clientId, user_id: userId, is_seed: options.seed ?? false },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const updateUserById = vi
    .fn()
    .mockResolvedValue(
      options.code
        ? { data: { user: null }, error: { code: options.code } }
        : { data: { user }, error: null },
    );
  const db = {
    rpc: vi
      .fn()
      .mockResolvedValue({ data: options.emailInUse ?? false, error: null }),
    from: vi.fn().mockReturnValue({ select }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        updateUserById,
      },
    },
  };
  return {
    db: db as unknown as SupabaseClient,
    updateUserById,
    getUserById: db.auth.admin.getUserById,
  };
}
describe("administrator client account editing", () => {
  it("rejects a claimed email before making any Auth changes", async () => {
    const mock = service({ emailInUse: true });
    await expect(
      updateClientAccount(mock.db, context, clientId, input),
    ).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
    expect(mock.updateUserById).not.toHaveBeenCalled();
  });
  it("normalizes email and leaves an empty password unchanged", () => {
    expect(
      clientAccountSchema.parse({
        ...input,
        email: " NEW@Example.invalid ",
        password: "",
      }),
    ).toEqual({ ...input, email: "new@example.invalid", password: undefined });
    expect(
      clientAccountSchema.safeParse({ ...input, password: "1234567" }).success,
    ).toBe(false);
    expect(
      clientAccountSchema.safeParse({ ...input, email: "broken" }).success,
    ).toBe(false);
  });
  it("rejects attempts to edit roles, companies, or authorization metadata through the login form", () => {
    for (const field of [
      "platform_role",
      "company_id",
      "user_id",
      "app_metadata",
      "user_metadata",
    ])
      expect(
        clientAccountSchema.safeParse({ ...input, [field]: "forged" }).success,
      ).toBe(false);
  });
  it("updates credentials through Auth and never places a password in metadata or the response", async () => {
    const mock = service();
    const password = "temporary-password-123";
    const result = await updateClientAccount(mock.db, context, clientId, {
      ...input,
      password,
    });
    const [id, attributes] = mock.updateUserById.mock.calls[0];
    expect(id).toBe(userId);
    expect(attributes).toMatchObject({
      email: input.email,
      password,
      email_confirm: true,
      ban_duration: "none",
      user_metadata: { full_name: input.name, preserved: "value" },
    });
    expect(attributes.app_metadata.voixel_client_edit).toMatchObject({
      actor_id: context.id,
      client_id: clientId,
      active: true,
      password_changed: true,
    });
    expect(JSON.stringify(attributes.user_metadata)).not.toContain(password);
    expect(JSON.stringify(attributes.app_metadata)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(result).toEqual({ id: clientId, user_id: userId });
  });
  it("does not send a password when the admin leaves it blank", async () => {
    const mock = service();
    await updateClientAccount(
      mock.db,
      context,
      clientId,
      clientAccountSchema.parse({ ...input, password: "" }),
    );
    expect(mock.updateUserById.mock.calls[0][1]).not.toHaveProperty("password");
  });
  it("bans suspended logins in Auth", async () => {
    const mock = service();
    await updateClientAccount(mock.db, context, clientId, {
      ...input,
      active: false,
    });
    expect(mock.updateUserById.mock.calls[0][1].ban_duration).toBe("876000h");
  });
  it("denies clients, company administrators, and platform operators without users.manage before accessing Auth", async () => {
    for (const overrides of [
      { platform_role: null },
      { platform_role: "platform_admin" as const },
      { suspended: true },
    ]) {
      const mock = service();
      await expect(
        updateClientAccount(
          mock.db,
          { ...context, ...overrides },
          clientId,
          input,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mock.getUserById).not.toHaveBeenCalled();
      expect(mock.updateUserById).not.toHaveBeenCalled();
    }
  });
  it("does not allow arbitrary Auth users or records from another data mode to be edited", async () => {
    for (const options of [{ missing: true }, { seed: true }]) {
      const mock = service(options);
      await expect(
        updateClientAccount(mock.db, context, clientId, input),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mock.updateUserById).not.toHaveBeenCalled();
    }
  });
  it("returns useful errors for a duplicate email or rejected password", async () => {
    for (const [code, expected] of [
      ["email_exists", "EMAIL_IN_USE"],
      ["weak_password", "PASSWORD_REJECTED"],
      ["unexpected_failure", "CLIENT_UPDATE_FAILED"],
    ]) {
      const mock = service({ code });
      await expect(
        updateClientAccount(mock.db, context, clientId, input),
      ).rejects.toMatchObject({ code: expected });
    }
  });
});
