import { test, expect } from "@playwright/test";

test("verification restores only the pending email and cooldown after reload", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "voixel.pending-email-verification",
      JSON.stringify({
        email: "pending@example.invalid",
        resendAvailableAt: Date.now() + 60000,
      }),
    ),
  );
  await page.goto("/auth/verify");
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "pending@example.invalid",
  );
  await expect(
    page.getByRole("button", { name: /Resend code in/ }),
  ).toBeDisabled();
  const code = page.getByLabel("Verification code", { exact: true });
  await code.fill("012345");
  await expect(code).toHaveValue("012345");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.reload();
  await expect(code).toHaveValue("");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "pending@example.invalid",
  );
});

test("verification is readable in both themes at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/auth/verify");
  for (const theme of ["light", "dark"]) {
    const toggle = page.locator(".theme-toggle:visible");
    await expect(toggle).toBeEnabled();
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await toggle.click();
    await expect(
      page.getByLabel("Verification code", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("login links to verification and missing configuration fails closed", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await expect(
    page.getByRole("button", { name: "Verify and continue", exact: true }),
  ).toBeDisabled();
  for (const [path, data] of [
    ["verify-email", { email: "pending@example.invalid", code: "012345" }],
    ["resend-verification", { email: "pending@example.invalid" }],
  ] as const) {
    const response = await request.post(`/api/auth/${path}`, {
      data,
      headers: { Origin: "http://127.0.0.1:3100" },
    });
    expect(response.status()).toBe(503);
    const blocked = await request.post(`/api/auth/${path}`, {
      data,
      headers: { Origin: "https://attacker.invalid" },
    });
    expect(blocked.status()).toBe(403);
  }
});
