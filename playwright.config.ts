import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (plan 15.3) against the built app with next start, a fresh
// Postgres with made-up data, and the test inbox for sign-in codes. Run after
// pnpm build with pnpm test:e2e.

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "pnpm exec tsx tests/e2e/server.ts",
    url: "http://localhost:3100/sign-in",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
