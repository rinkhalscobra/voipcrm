import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3100", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  webServer: {
    command: "node scripts/browser-server.mjs",
    url: "http://127.0.0.1:3100/api/system/setup",
    timeout: 60000,
    reuseExistingServer: false,
  },
});
