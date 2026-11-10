import { createClient } from "@supabase/supabase-js";
const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BOOTSTRAP_EMAIL,
  BOOTSTRAP_PASSWORD,
} = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOOTSTRAP_EMAIL)
  throw new Error("Set Supabase credentials and BOOTSTRAP_EMAIL in .env first");
const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const owners = await db
  .from("profiles")
  .select("id")
  .eq("platform_role", "super_admin");
if (owners.error) throw new Error("Apply the database migrations first");
if (owners.data.length)
  throw new Error(
    "An owner already exists. Bootstrap will not modify an existing owner.",
  );
if (BOOTSTRAP_PASSWORD && BOOTSTRAP_PASSWORD.length < 8)
  throw new Error("Bootstrap password must contain at least 8 characters");
const result = BOOTSTRAP_PASSWORD
  ? await db.auth.admin.createUser({
      email: BOOTSTRAP_EMAIL,
      password: BOOTSTRAP_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Platform owner" },
    })
  : await db.auth.admin.inviteUserByEmail(BOOTSTRAP_EMAIL, {
      redirectTo: `${process.env.APP_URL}/auth/complete`,
      data: { full_name: "Platform owner" },
    });
if (result.error || !result.data.user)
  throw new Error(
    "Owner creation failed. Check email delivery and the Supabase Auth configuration.",
  );
const updated = await db
  .from("profiles")
  .update({ platform_role: "super_admin" })
  .eq("id", result.data.user.id)
  .select("id")
  .single();
if (updated.error) {
  await db.auth.admin.deleteUser(result.data.user.id);
  throw new Error(
    "Owner role assignment failed; the new auth account was removed.",
  );
}
console.log(
  BOOTSTRAP_PASSWORD
    ? "Owner created. Sign in with your email and password."
    : "Owner invitation sent. Accept the invitation, set your password, and sign in.",
);
