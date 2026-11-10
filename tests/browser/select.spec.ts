import { test, expect, type Page } from "@playwright/test";

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} date-range menu supports selection, keyboard navigation, and dismissal`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("voixel.theme", value),
      theme,
    );
    await page.goto("/admin");
    const range = page.getByRole("combobox", {
      name: "Dashboard date range",
      exact: true,
    });
    await range.click();
    const menu = page.getByRole("listbox");
    await expect(menu).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(25, 28, 40)",
    );
    await expect(page.getByRole("option")).toHaveText([
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
    ]);
    await page.getByRole("option", { name: "Last 30 days" }).click();
    await expect(range).toHaveText("Last 30 days");
    await expect(range).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("option", { name: "Last 90 days" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(range).toHaveText("Last 90 days");
    await range.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(range).toBeFocused();
    await range.click();
    const heading = await page.locator(".page-heading h1").boundingBox();
    await page.mouse.click(heading!.x + 10, heading!.y + 10);
    await expect(menu).toHaveCount(0);
  });
}

test("call-status filters can return to the empty All statuses value", async ({
  page,
}) => {
  await page.goto("/admin/calls");
  const filter = page.getByRole("combobox", {
    name: "Filter call status",
    exact: true,
  });
  await expect(filter).toHaveText("All statuses");
  await choose(page, "Filter call status", "answer");
  await expect(filter).toHaveText("answer");
  await choose(page, "Filter call status", "All statuses");
  await expect(filter).toHaveText("All statuses");
});

test("profile selection supports typeahead and form reset", async ({
  page,
}) => {
  await page.goto("/admin/profile");
  const availability = page.getByRole("combobox", {
    name: "Local availability",
    exact: true,
  });
  await expect(availability).toHaveText("offline");
  await availability.focus();
  await page.keyboard.press("b");
  await expect(availability).toHaveText("busy");
  await page.locator(".settings-panel form").evaluate((form) => {
    (form as HTMLFormElement).reset();
  });
  await expect(availability).toHaveText("offline");
});

test("required dropdowns focus the styled control and block incomplete submissions", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.goto("/admin/dialer");
  const identity = page.getByRole("combobox", {
    name: "Calling identity",
    exact: true,
  });
  await page.getByLabel("Destination phone number").fill("+493012345678");
  await page.locator(".dialer-card form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(identity).toBeFocused();
  await expect(identity).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("alert").filter({ hasText: "Please select an option." }),
  ).toBeVisible();
  await identity.click();
  await expect(page.getByRole("listbox")).toContainText(
    "No authorized identities available",
  );
  expect(writes).toEqual([]);
});

test("all dropdown entry points render styled controls instead of native popups", async ({
  page,
}) => {
  for (const path of [
    "/admin",
    "/admin/calls",
    "/admin/profile",
    "/admin/dialer",
    "/register",
  ]) {
    await page.goto(path);
    await expect(page.locator("button.select-trigger").first()).toBeVisible();
    const nativeControls = page.locator("select");
    for (const native of await nativeControls.all()) {
      await expect(native).toHaveAttribute("aria-hidden", "true");
      await expect(native).toHaveAttribute("tabindex", "-1");
      const bounds = await native.boundingBox();
      expect(bounds?.width ?? 0).toBeLessThanOrEqual(1);
      expect(bounds?.height ?? 0).toBeLessThanOrEqual(1);
    }
  }
});

test.describe("touch dropdowns", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 320, height: 844 },
  });

  test("currency selection stays inside the viewport in both themes", async ({
    page,
  }) => {
    await page.goto("/register");
    const currency = page.getByRole("combobox", {
      name: "Billing currency",
      exact: true,
    });
    for (const theme of ["light", "dark"] as const) {
      const toggle = page.locator(".theme-toggle:visible");
      await expect(toggle).toBeEnabled();
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await toggle.tap();
      await currency.tap();
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
      await page.getByRole("option", { name: "GBP", exact: true }).tap();
      await expect(currency).toHaveText("GBP");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  });
});
