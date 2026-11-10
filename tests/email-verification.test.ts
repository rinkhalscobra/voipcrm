import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyEmailSchema } from "../src/lib/auth/email-verification-schema";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  signUp: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  serverDatabase: vi.fn(async () => ({ auth: mocks })),
  serviceDatabase: vi.fn(() => ({ rpc: mocks.rpc })),
}));
import {
  verifySignupEmail,
  resendSignupEmail,
} from "../src/lib/auth/email-verification";
import { registerWorkspace } from "../src/lib/auth/registration";

const email = "new@example.invalid";
function request(data: unknown) {
  return new Request("http://localhost/api/auth/verify-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "192.0.2.100",
    },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.verifyOtp.mockResolvedValue({
    data: {
      session: { access_token: "never-return-this-token" },
      user: { email_confirmed_at: "2026-11-10T12:00:00Z" },
    },
    error: null,
  });
  mocks.resend.mockResolvedValue({ data: {}, error: null });
});

describe("email verification and resend", () => {
  it("keeps leading zeroes and normalizes the email", () => {
    expect(
      verifyEmailSchema.parse({
        email: " NEW@Example.invalid ",
        code: "012345",
      }),
    ).toEqual({ email, code: "012345" });
  });
  it.each(["12345", "1234567", "12345a", 123456, "１２３４５６"])(
    "rejects malformed code %s before calling Auth",
    async (code) => {
      await expect(
        verifySignupEmail(request({ email, code })),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects caller-controlled verification types and account privileges", async () => {
    for (const extra of [
      { type: "recovery" },
      { email_confirm: true },
      { role: "super_admin" },
    ])
      await expect(
        verifySignupEmail(request({ email, code: "012345", ...extra })),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("verifies the submitted code through Auth and returns no session secrets", async () => {
    const response = await verifySignupEmail(
      request({ email, code: "012345" }),
    );
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email,
      token: "012345",
      type: "email",
    });
    expect(await response.json()).toEqual({ data: { verified: true } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const keys = mocks.rpc.mock.calls.map(([, params]) => params.p_key);
    expect(
      keys.every((key) => !key.includes(email) && !key.includes("192.0.2.100")),
    ).toBe(true);
  });
  it.each(["otp_expired", "otp_disabled"])(
    "rejects wrong or expired codes (%s)",
    async (code) => {
      mocks.verifyOtp.mockResolvedValue({
        data: { session: null, user: null },
        error: { code, status: 403, message: "Private provider details" },
      });
      await expect(
        verifySignupEmail(request({ email, code: "123456" })),
      ).rejects.toMatchObject({
        code: "VERIFICATION_CODE_INVALID",
        status: 400,
      });
    },
  );
  it("requires both a real session and a verified email", async () => {
    for (const data of [
      { session: null, user: { email_confirmed_at: "today" } },
      { session: {}, user: { email_confirmed_at: null } },
    ]) {
      mocks.verifyOtp.mockResolvedValue({ data, error: null });
      await expect(
        verifySignupEmail(request({ email, code: "123456" })),
      ).rejects.toMatchObject({ code: "VERIFICATION_CODE_INVALID" });
    }
  });
  it("blocks repeated guesses before contacting Auth", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      verifySignupEmail(request({ email, code: "123456" })),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
  it("resends only existing signup confirmations without creating users", async () => {
    const response = await resendSignupEmail(request({ email }));
    expect(mocks.resend).toHaveBeenCalledWith({ type: "signup", email });
    expect(await response.json()).toEqual({
      data: { sent: true, resendAfterSeconds: 60 },
    });
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_limit: 1,
      p_seconds: 60,
    });
  });
  it("blocks resend cooldown violations without sending an email", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(resendSignupEmail(request({ email }))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(mocks.resend).not.toHaveBeenCalled();
  });
  it("does not disclose whether the address has an account", async () => {
    const results = [];
    for (const data of [{ user: null }, { user: { id: "existing-account" } }]) {
      mocks.resend.mockResolvedValue({ data, error: null });
      results.push(await (await resendSignupEmail(request({ email }))).json());
    }
    expect(results[0]).toEqual(results[1]);
  });
  it("maps SMTP errors to a public delivery failure", async () => {
    mocks.resend.mockResolvedValue({
      error: { status: 500, message: "SMTP password=must-not-leak" },
    });
    await expect(resendSignupEmail(request({ email }))).rejects.toMatchObject({
      code: "EMAIL_DELIVERY_FAILED",
      message: "EMAIL_DELIVERY_FAILED",
      status: 502,
    });
  });
  it.each(["verify", "resend"])(
    "preserves provider rate limits for %s",
    async (action) => {
      mocks.verifyOtp.mockResolvedValue({ data: {}, error: { status: 429 } });
      mocks.resend.mockResolvedValue({ error: { status: 429 } });
      const result =
        action === "verify"
          ? verifySignupEmail(request({ email, code: "123456" }))
          : resendSignupEmail(request({ email }));
      await expect(result).rejects.toMatchObject({
        code: "RATE_LIMITED",
        status: 429,
      });
    },
  );
  it("starts the code flow after signup without exposing the password or Auth identity", async () => {
    mocks.signUp.mockResolvedValue({
      data: { session: null, user: { id: "private-user-id" } },
      error: null,
    });
    const response = await registerWorkspace(
      request({
        full_name: "Test owner",
        company_name: "Test company",
        email,
        password: "12345678",
        country: "Germany",
        currency: "EUR",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: { requiresEmailVerification: true, resendAfterSeconds: 60 },
    });
  });
});
