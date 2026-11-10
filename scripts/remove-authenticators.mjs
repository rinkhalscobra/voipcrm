import { createClient } from "@supabase/supabase-js";
import { management, sql } from "./management.mjs";
await management("/config/auth", {
  method: "PATCH",
  body: {
    mfa_totp_enroll_enabled: false,
    mfa_totp_verify_enabled: false,
    mfa_phone_enroll_enabled: false,
    mfa_phone_verify_enabled: false,
    mfa_web_authn_enroll_enabled: false,
    mfa_web_authn_verify_enabled: false,
  },
});
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const factors = await sql("select id,user_id from auth.mfa_factors", true);
for (const factor of factors) {
  const result = await service.auth.admin.mfa.deleteFactor({
    userId: factor.user_id,
    id: factor.id,
  });
  if (result.error)
    throw new Error("An enrolled authenticator could not be removed");
}
const remaining = await sql(
  "select count(*)::int as count from auth.mfa_factors",
  true,
);
if (remaining[0].count !== 0)
  throw new Error("Some authenticator factors remain registered");
console.log(
  JSON.stringify({
    authenticatorEnrollmentDisabled: true,
    authenticatorVerificationDisabled: true,
    removedFactors: factors.length,
    remainingFactors: 0,
  }),
);
