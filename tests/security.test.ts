import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptCredential,
  decryptCredential,
  scrubProviderPayload,
} from "../src/lib/security/crypto";
import { hasPermission, canReadSnapshot } from "../src/lib/auth/permissions";
import type { UserContext } from "../src/lib/types";
const context: UserContext = {
  id: "agent-a",
  full_name: "Test Agent",
  platform_role: null,
  suspended: false,
  permissions: ["calls.read"],
  membership: {
    id: "membership",
    user_id: "agent-a",
    company_id: "company-a",
    role: "agent",
    manager_id: "manager-a",
    team_leader_id: "leader-a",
    active: true,
  },
};
describe("authorization boundaries", () => {
  it("denies a tenant with a matching user but a different company", () =>
    expect(
      canReadSnapshot(context, {
        company_id: "company-b",
        user_id: "agent-a",
        manager_id: null,
        team_leader_id: null,
      }),
    ).toBe(false));
  it("denies other agents in the same company", () =>
    expect(
      canReadSnapshot(context, {
        company_id: "company-a",
        user_id: "agent-b",
        manager_id: null,
        team_leader_id: null,
      }),
    ).toBe(false));
  it("allows a manager only for captured manager ownership", () => {
    const manager = {
      ...context,
      id: "manager-a",
      membership: { ...context.membership!, role: "manager" as const },
    };
    expect(
      canReadSnapshot(manager, {
        company_id: "company-a",
        user_id: "agent-b",
        manager_id: "manager-a",
        team_leader_id: null,
      }),
    ).toBe(true);
    expect(
      canReadSnapshot(manager, {
        company_id: "company-a",
        user_id: "agent-b",
        manager_id: "manager-b",
        team_leader_id: null,
      }),
    ).toBe(false);
  });
  it("denies platform admin privileges unless explicitly granted", () =>
    expect(
      hasPermission(
        { ...context, platform_role: "platform_admin" },
        "providers.manage",
      ),
    ).toBe(false));
  it("revokes suspended super administrators", () =>
    expect(
      hasPermission(
        { ...context, platform_role: "super_admin", suspended: true },
        "finance.write",
      ),
    ).toBe(false));
});
describe("credential protection", () => {
  beforeAll(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  it("encrypts credentials with per-account authenticated context", () => {
    const encrypted = encryptCredential(
      "test-fixture-not-a-real-key",
      "account-a",
    );
    expect(encrypted).not.toContain("test-fixture");
    expect(decryptCredential(encrypted, "account-a")).toBe(
      "test-fixture-not-a-real-key",
    );
    expect(() => decryptCredential(encrypted, "account-b")).toThrow();
  });
  it("rejects tampered ciphertext", () => {
    const e = encryptCredential("fixture", "a");
    const [version, iv, tag, cipher] = e.split(".");
    const bytes = Buffer.from(cipher, "base64");
    bytes[0] ^= 1;
    expect(() =>
      decryptCredential(
        [version, iv, tag, bytes.toString("base64")].join("."),
        "a",
      ),
    ).toThrow();
  });
  it("removes upstream user API keys and nested passwords", () => {
    expect(
      scrubProviderPayload({
        id: 1,
        api_key: "sensitive",
        relations: {
          devices: [
            {
              name: "extension",
              password: "sensitive",
              connection: { token: "sensitive", latency: 5 },
            },
          ],
        },
      }),
    ).toEqual({
      id: 1,
      relations: {
        devices: [{ name: "extension", connection: { latency: 5 } }],
      },
    });
  });
});
