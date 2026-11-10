import { createClient } from "@supabase/supabase-js";
import { isDemoData } from "../src/lib/data-mode";
const {
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
} = process.env;
if (!isDemoData())
  throw new Error("Demo admin provisioning is available only in demo mode");
if (
  !NEXT_PUBLIC_SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  !DEMO_ADMIN_EMAIL ||
  !DEMO_ADMIN_PASSWORD
)
  throw new Error("Configure the Supabase and DEMO_ADMIN_* values in .env");
const service = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let existing: { id: string } | undefined;
for (let page = 1; ; page++) {
  const result = await service.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error)
    throw new Error("Unable to inspect the requested administrator account");
  existing = result.data.users.find(
    (user) => user.email?.toLowerCase() === DEMO_ADMIN_EMAIL.toLowerCase(),
  );
  if (existing || result.data.users.length < 1000) break;
}
const account = existing
  ? await service.auth.admin.updateUserById(existing.id, {
      password: DEMO_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Big Boss" },
    })
  : await service.auth.admin.createUser({
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Big Boss" },
    });
if (account.error || !account.data.user)
  throw new Error(
    `Administrator account could not be provisioned (${account.error?.code ?? "AUTH_FAILED"})`,
  );
const profile = await service
  .from("profiles")
  .update({
    full_name: "Big Boss",
    platform_role: "super_admin",
    suspended: false,
    is_seed: false,
  })
  .eq("id", account.data.user.id)
  .select("id")
  .single();
if (profile.error)
  throw new Error("The administrator profile could not be updated");
const audit = await service.from("audit_logs").insert({
  action: "platform.admin_provisioned",
  resource_id: account.data.user.id,
  metadata: { initializer: "demo_admin", role: "super_admin" },
});
if (audit.error) throw new Error("Administrator creation audit failed");
const user = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const login = await user.auth.signInWithPassword({
  email: DEMO_ADMIN_EMAIL,
  password: DEMO_ADMIN_PASSWORD,
});
if (login.error) throw new Error("Administrator password verification failed");
const context = await user.rpc("my_context");
if (context.error || context.data?.platform_role !== "super_admin")
  throw new Error("Administrator role verification failed");
await user.auth.signOut({ scope: "local" });
console.log(
  JSON.stringify({
    email: DEMO_ADMIN_EMAIL,
    displayName: "Big Boss",
    role: "super_admin",
    passwordVerified: true,
    mfaRequired: false,
  }),
);
