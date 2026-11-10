import { test, expect } from "@playwright/test";
test("unconfigured workspace shows no fabricated operational metrics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your operations center is ready to connect"),
  ).toBeVisible();
  await expect(page.locator(".metric-value").first()).toHaveText("—");
  await expect(page.getByText("No provider data connected")).toBeVisible();
  expect(errors).toEqual([]);
});
test("setup checklist opens and closes", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: "Set up workspace" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Apply the SQL migrations",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("provider UI disables connections until database configuration", async ({
  page,
}) => {
  await page.goto("/admin/providers");
  await expect(
    page.getByRole("heading", { name: "Provider accounts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect account", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Number purchasing", { exact: true }),
  ).toBeVisible();
});
test("every navigation module resolves with an empty or setup state", async ({
  page,
}) => {
  for (const path of [
    "companies",
    "numbers",
    "number-orders",
    "calls",
    "users",
    "teams",
    "pricing",
    "wallets",
    "billing",
    "reports",
    "notifications",
    "audit-logs",
    "settings",
  ]) {
    const response = await page.goto(`/admin/${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByText("Setup required", { exact: true }).last(),
    ).toBeVisible();
  }
});
test("global search navigates to an actual module", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: /Search workspace/ }).click();
  await page.getByRole("textbox", { name: "Search navigation" }).fill("wallet");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Customer wallets" })
    .click();
  await expect(page).toHaveURL(/\/admin\/wallets$/);
});
test("mobile navigation is accessible and stays within viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Provider accounts" })
    .click();
  await expect(page).toHaveURL(/\/admin\/providers$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("login offers registration and remains disabled without authentication configuration", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "New workspaces can register. Existing companies use invitations.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(
    page.getByRole("heading", { name: "Create your workspace" }),
  ).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Company name", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
});
test("the registration form fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/register");
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Billing currency", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("API fails closed and uses structured errors", async ({ request }) => {
  const read = await request.get("/api/admin/companies");
  expect(read.status()).toBe(503);
  expect((await read.json()).error.code).toBe("SETUP_REQUIRED");
  const crossOrigin = await request.post("/api/admin/companies", {
    headers: { Origin: "https://attacker.invalid" },
    data: { name: "attempt" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect((await crossOrigin.json()).error.code).toBe("FORBIDDEN");
});
test("desktop dashboard reference screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
});
