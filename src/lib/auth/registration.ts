import "server-only";
import { createHash } from "node:crypto";
import { body, ok } from "../api/http";
import { AppError, databaseError } from "../errors";
import { serverDatabase, serviceDatabase } from "../supabase/server";
import { registrationSchema } from "./registration-schema";

export async function registerWorkspace(request: Request) {
  const db = await serverDatabase();
  const input = await body(request, registrationSchema);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const limits = [
    { key: `registration:ip:${digest(ip)}`, limit: 10 },
    { key: `registration:email:${digest(input.email)}`, limit: 3 },
  ];
  for (const limit of limits) {
    const result = await serviceDatabase().rpc("consume_rate_limit", {
      p_key: limit.key,
      p_limit: limit.limit,
      p_seconds: 900,
    });
    databaseError(result.error);
    if (!result.data) throw new AppError("RATE_LIMITED", 429);
  }
  const result = await db.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${process.env.APP_URL}/auth/confirm`,
      data: {
        full_name: input.full_name,
        registration_company_name: input.company_name,
        registration_currency: input.currency,
        registration_country: input.country,
      },
    },
  });
  if (result.error || !result.data.user)
    throw new AppError("REGISTRATION_FAILED", 409);
  // Supabase writes the session into secure session cookies in demo mode.
  // Live mode waits for the confirmation email before issuing that session.
  return ok(
    { requiresEmailVerification: !result.data.session },
    undefined,
    201,
  );
}
