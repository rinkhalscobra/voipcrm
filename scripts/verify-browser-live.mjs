import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "./management.mjs";
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const email = `verification-${randomUUID()}@example.invalid`,
  password = randomBytes(24).toString("base64url");
let userId, browser;
try {
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Temporary browser verification" },
  });
  if (created.error)
    throw new Error("Could not create temporary verification identity");
  userId = created.data.user.id;
  await sql(
    `update public.profiles set platform_role='super_admin' where id='${userId}';`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3000/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin", { timeout: 30000 });
  await page.goto("http://127.0.0.1:3000/auth/security");
  await page.waitForURL("**/admin", { timeout: 30000 });
  await page.getByRole("heading", { name: "Operations overview" }).waitFor();
  const results = await page.evaluate(async () => {
    const paths = [
      "admin/dashboard",
      "admin/companies",
      "admin/providers",
      "admin/numbers",
      "admin/calls",
      "admin/users",
      "admin/teams",
      "admin/pricing",
      "admin/wallets",
      "admin/billing",
      "admin/reports",
      "admin/notifications",
      "admin/audit-logs",
      "admin/settings",
    ];
    const results = [];
    for (const path of paths) {
      const response = await fetch(`/api/${path}`);
      const payload = await response.json();
      results.push({
        path,
        status: response.status,
        error: payload.error?.code,
      });
    }
    return results;
  });
  const failed = results.filter((r) => r.status !== 200);
  if (failed.length)
    throw new Error(`Live API failures: ${JSON.stringify(failed)}`);
  if (process.env.DATA_MODE === "demo") {
    await page.locator(".demo-banner").waitFor();
    const demo = await page.evaluate(async () => {
      const dashboard = await (await fetch("/api/admin/dashboard")).json();
      const provider = dashboard.data.providers[0];
      const blocked = await fetch(`/api/admin/providers/${provider.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const call = await fetch("/api/calls/click2call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return {
        companies: dashboard.data.companies.length,
        providers: dashboard.data.providers.length,
        numbers: dashboard.data.numberCount,
        calls: dashboard.data.callCount,
        providerAction: blocked.status,
        callAction: call.status,
      };
    });
    if (
      demo.companies < 6 ||
      demo.providers !== 3 ||
      demo.numbers !== 36 ||
      demo.calls < 1 ||
      demo.providerAction !== 409 ||
      demo.callAction !== 409
    )
      throw new Error(`Demo verification failed: ${JSON.stringify(demo)}`);
    console.log(JSON.stringify({ demoVerification: demo }));
    const document = await page.evaluate(async () => {
      const invoices = await (await fetch("/api/admin/billing")).json();
      const response = await fetch(
        `/api/admin/billing/${invoices.data[0].id}/pdf`,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        filename: response.headers.get("content-disposition"),
        signature: String.fromCharCode(...bytes.slice(0, 4)),
      };
    });
    if (
      document.status !== 200 ||
      !document.filename?.includes("invoice-demo.pdf") ||
      document.signature !== "%PDF"
    )
      throw new Error(
        `Demo invoice PDF verification failed: ${JSON.stringify(document)}`,
      );
  }
  await page.screenshot({
    path:
      process.env.DATA_MODE === "demo"
        ? "test-results/demo-dashboard.png"
        : "test-results/live-dashboard.png",
    fullPage: true,
  });
  if (process.env.DATA_MODE === "demo")
    console.log(
      JSON.stringify({
        chartPaths: await page
          .locator(".recharts-area-curve")
          .evaluateAll((paths) =>
            paths.map((p) => ({
              length: p.getAttribute("d")?.length ?? 0,
              stroke: p.getAttribute("stroke"),
            })),
          ),
      }),
    );
  if (process.env.DATA_MODE === "demo") {
    await page.goto("http://127.0.0.1:3000/admin/providers");
    await page
      .getByRole("heading", { name: "Provider accounts", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Test", exact: true })
      .first()
      .waitFor();
    if (
      (await page
        .getByRole("button", { name: "Test", exact: true })
        .count()) !== 3
    )
      throw new Error("Demo provider cards are missing");
    for (const button of await page
      .getByRole("button", { name: "Test", exact: true })
      .all())
      if (await button.isEnabled())
        throw new Error("A real provider test was enabled in demo mode");
    await page.screenshot({
      path: "test-results/demo-providers.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://127.0.0.1:3000/admin");
    await page.locator(".demo-banner").waitFor();
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ))
    )
      throw new Error("Demo dashboard overflows the mobile viewport");
    await page.screenshot({
      path: "test-results/demo-mobile.png",
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        demoPresentationChecks: [
          "synthetic PDF invoice",
          "three disabled provider cards",
          "mobile layout",
        ],
      }),
    );
  }
  if (errors.length)
    throw new Error(`Browser runtime errors: ${errors.join("; ")}`);
  console.log(
    JSON.stringify({
      liveBrowserVerification: "passed",
      checks: [
        "email/password authentication",
        "password-only dashboard access",
        "retired authenticator route redirects to workspace",
        "authenticated dashboard",
        `${results.length} authenticated API modules`,
      ],
      temporaryIdentityRemovedInFinally: true,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (userId) {
    const removedLogs = await service
      .from("login_history")
      .delete()
      .eq("user_id", userId);
    if (removedLogs.error)
      throw new Error("Verification login history cleanup failed");
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error)
      throw new Error("Temporary verification identity cleanup failed");
  }
}
