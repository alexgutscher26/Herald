import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-browser widget matrix.
 *
 * The manual matrix in docs/widget-browser-smoke.md needs a real browser for
 * focus, reduced motion and degraded states. This suite serves a host page and
 * the shipped loader from a fixture origin, so it needs no database and no
 * application build; the real panel stays covered by the integration suites.
 */
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun tests/browser/fixture-server.ts",
    url: "http://127.0.0.1:4173/host",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
