import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { management, sql } from "./management.mjs";
const browser = await chromium.launch({ headless: true });
let sessionClient;
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.APP_URL}/login`);
  await page
    .getByLabel("Email address", { exact: true })
    .fill(process.env.DEMO_ADMIN_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin", { timeout: 30000 });
  await page
    .getByRole("heading", { name: "Operations overview", exact: true })
    .waitFor();
  const cookies = await page.context().cookies();
  sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => cookies, setAll: () => {} } },
  );
  const verified = await sessionClient.auth.getUser();
  if (
    verified.error ||
    verified.data.user?.email !== process.env.DEMO_ADMIN_EMAIL
  )
    throw new Error("The requested administrator could not sign in");
  const {
    data: { session },
  } = await sessionClient.auth.getSession();
  const claims = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString(
      "utf8",
    ),
  );
  if (claims.aal !== "aal1")
    throw new Error("The browser did not use a password-only session");
  const dashboard = await page.request.get(
    `${process.env.APP_URL}/api/admin/dashboard`,
  );
  if (dashboard.status() !== 200)
    throw new Error("Password-only admin API access failed");
  await page.goto(`${process.env.APP_URL}/auth/security`);
  await page.waitForURL("**/admin", { timeout: 30000 });
  await page.goto(`${process.env.APP_URL}/admin/settings`);
  if (
    await page
      .getByRole("link", { name: "Two-factor authentication", exact: true })
      .count()
  )
    throw new Error("An authenticator enrollment link remains visible");
  const factors = await sql(
    "select count(*)::int as count from auth.mfa_factors",
    true,
  );
  const config = await management("/config/auth");
  if (
    factors[0].count !== 0 ||
    Object.entries(config).some(
      ([key, value]) =>
        /^mfa_.*(?:enroll|verify)_enabled$/.test(key) && value === true,
    )
  )
    throw new Error(
      "An authenticator factor or enrollment setting is still enabled",
    );
  console.log(
    JSON.stringify({
      email: verified.data.user.email,
      passwordOnlyLogin: true,
      adminApiAccessible: true,
      authenticatorRouteRedirects: true,
      registeredFactors: 0,
    }),
  );
} finally {
  if (sessionClient) await sessionClient.auth.signOut({ scope: "local" });
  await browser.close();
}
