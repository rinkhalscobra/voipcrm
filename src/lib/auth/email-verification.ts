import "server-only";
import { createHash } from "node:crypto";
import { body, ok } from "../api/http";
import { AppError, databaseError } from "../errors";
import { serverDatabase, serviceDatabase } from "../supabase/server";
import {
  resendVerificationSchema,
  verifyEmailSchema,
} from "./email-verification-schema";
import settings from "./email-verification-settings.json";

export async function verificationRateLimit(
  request: Request,
  email: string,
  action: "verify" | "resend",
) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const limits =
    action === "verify"
      ? [
          {
            key: `email-verification:email:${digest(email)}`,
            limit: 10,
            seconds: 600,
          },
          {
            key: `email-verification:ip:${digest(ip)}`,
            limit: 40,
            seconds: 600,
          },
        ]
      : [
          {
            key: `verification-resend:cooldown:${digest(email)}`,
            limit: 1,
            seconds: settings.resendAfterSeconds,
          },
          {
            key: `verification-resend:email:${digest(email)}`,
            limit: 5,
            seconds: 3600,
          },
          {
            key: `verification-resend:ip:${digest(ip)}`,
            limit: 20,
            seconds: 3600,
          },
        ];
  for (const limit of limits) {
    const result = await serviceDatabase().rpc("consume_rate_limit", {
      p_key: limit.key,
      p_limit: limit.limit,
      p_seconds: limit.seconds,
    });
    databaseError(result.error);
    if (!result.data) throw new AppError("RATE_LIMITED", 429);
  }
}

export async function verifySignupEmail(request: Request) {
  const input = await body(request, verifyEmailSchema);
  const db = await serverDatabase();
  await verificationRateLimit(request, input.email, "verify");
  const result = await db.auth.verifyOtp({
    email: input.email,
    token: input.code,
    type: "email",
  });
  if (result.error?.status === 429) throw new AppError("RATE_LIMITED", 429);
  if (
    result.error ||
    !result.data.session ||
    !result.data.user?.email_confirmed_at
  )
    throw new AppError("VERIFICATION_CODE_INVALID", 400);
  return ok({ verified: true });
}

export async function resendSignupEmail(request: Request) {
  const input = await body(request, resendVerificationSchema);
  const db = await serverDatabase();
  await verificationRateLimit(request, input.email, "resend");
  const result = await db.auth.resend({ type: "signup", email: input.email });
  if (result.error?.status === 429) throw new AppError("RATE_LIMITED", 429);
  if (result.error) throw new AppError("EMAIL_DELIVERY_FAILED", 502);
  // The response never discloses whether an address has an existing account.
  return ok({ sent: true, resendAfterSeconds: settings.resendAfterSeconds });
}
