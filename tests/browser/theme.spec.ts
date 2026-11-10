import { test, expect, type Page } from "@playwright/test";

async function theme(page: Page, value: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
  await expect(page.locator("html")).toHaveCSS("color-scheme", value);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    value === "light" ? "rgb(245, 246, 251)" : "rgb(12, 14, 22)",
  );
}

test("system mode follows the device and manual choices override it", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/admin/settings");
  const system = page.getByRole("button", { name: "System", exact: true });
  await expect(system).toBeEnabled();
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await theme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await theme(page, "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await theme(page, "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await theme(page, "dark");
  await system.click();
  await theme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await theme(page, "dark");
  expect(await page.evaluate(() => localStorage.getItem("voixel.theme"))).toBe(
    "system",
  );
});

test("the header toggle persists through reloads and navigation and works with the keyboard", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/admin");
  const toggle = page.getByRole("button", {
    name: "Switch to light mode",
    exact: true,
  });
  await expect(toggle).toBeEnabled();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await theme(page, "light");
  await page.reload();
  await theme(page, "light");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Companies", exact: true })
    .click();
  await theme(page, "light");
  await expect(
    page.locator('meta[name="theme-color"]').first(),
  ).toHaveAttribute("content", "#f5f6fb");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await theme(page, "dark");
  await page.goto("/login");
  await theme(page, "dark");
});

test("theme changes synchronize between tabs, including an open portal dialog", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Switch to light mode", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /Search workspace/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(25, 28, 40)");
  const other = await context.newPage();
  await other.goto("/login");
  // A second page may have its own OS preference; choose an explicit theme.
  const picker = other.getByRole("button", {
    name: /Switch to (light|dark) mode/,
  });
  await expect(picker).toBeEnabled();
  if ((await picker.getAttribute("aria-label")) === "Switch to dark mode")
    await picker.click();
  await other
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await theme(page, "light");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dialog.locator(".search-box")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(dialog.getByRole("textbox")).toHaveCSS(
    "color",
    "rgb(32, 38, 56)",
  );
  await other
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await theme(page, "dark");
  await expect(dialog).toHaveCSS("background-color", "rgb(25, 28, 40)");
});

test("both themes cover public pages, every main module, and every workspace", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/settings");
  for (const value of ["light", "dark"] as const) {
    await page.goto("/admin/settings");
    await page
      .getByRole("button", {
        name: value === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    for (const path of [
      "/login",
      "/register",
      "/auth/reset",
      "/auth/password",
      "/auth/complete",
      "/unavailable-route",
      "/admin",
      "/admin/companies",
      "/admin/clients",
      "/admin/providers",
      "/admin/numbers",
      "/admin/number-orders",
      "/admin/calls",
      "/admin/users",
      "/admin/teams",
      "/admin/departments",
      "/admin/pricing",
      "/admin/client-balances",
      "/admin/wallets",
      "/admin/billing",
      "/admin/reports",
      "/admin/notifications",
      "/admin/audit-logs",
      "/admin/settings",
      "/admin/profile",
      "/dialer",
      "/company",
      "/manager",
      "/team-leader",
      "/agent",
      "/client",
    ]) {
      await page.goto(path);
      await theme(page, value);
      if (value === "light") {
        const darkSurfaces = await page
          .locator(".panel,.sidebar,.topbar,.form-input,.dialog-content")
          .evaluateAll(
            (elements) =>
              elements.filter((element) => {
                const color =
                  getComputedStyle(element)
                    .backgroundColor.match(/[\d.]+/g)
                    ?.map(Number) ?? [];
                return (
                  color.length >= 3 &&
                  (color[3] ?? 1) > 0.9 &&
                  Math.max(...color.slice(0, 3)) < 140
                );
              }).length,
          );
        expect(darkSurfaces, `Dark surface remained on ${path}`).toBe(0);
      }
    }
  }
  expect(errors).toEqual([]);
});

for (const saved of ["light", "dark"] as const) {
  test(`saved ${saved} mode applies before hydration`, async ({ page }) => {
    await page.emulateMedia({
      colorScheme: saved === "light" ? "dark" : "light",
    });
    await page.addInitScript(
      (value) => localStorage.setItem("voixel.theme", value),
      saved,
    );
    await page.route(/\/_next\/.*\.js(?:\?|$)/, (route) => route.abort());
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await theme(page, saved);
    await expect(
      page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".public-theme-control button")).toBeDisabled();
  });
}

test("switching still works when browser storage is unavailable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    }),
  );
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await theme(page, "light");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await theme(page, "dark");
  expect(errors).toEqual([]);
});

test("both themes work on narrow screens with accessible navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/admin");
  for (const value of ["light", "dark"] as const) {
    await page
      .getByRole("button", {
        name:
          value === "light" ? "Switch to light mode" : "Switch to dark mode",
        exact: true,
      })
      .click();
    await theme(page, value);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await expect(page.locator(".sidebar.open")).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "Color theme", exact: true }),
    ).toBeVisible();
    await theme(page, value);
    await page.goto("/register");
    await theme(page, value);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto("/admin");
  }
});
