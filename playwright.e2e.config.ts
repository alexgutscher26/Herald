import { defineConfig, devices } from "@playwright/test";

/**
 * Seeded end-to-end suite.
 *
 * Separate from `playwright.config.ts` (the database-free widget matrix) on
 * purpose: these flows need the real application, a migrated Postgres
 * database and the fixtures from `scripts/e2e/seed.ts`.
 *
 * Local run:
 *   bun run e2e:db && bun run e2e:seed && bun run e2e
 *
 * Against an already-seeded preview deployment (CI or staging):
 *   E2E_BASE_URL=https://preview.example bun run e2e
 * In that mode Playwright does not start or seed a server; the deployment
 * owns both.
 */
const external = Boolean(process.env.E2E_BASE_URL);
const baseURL = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const local = !external && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL);
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? "postgres://herald:herald@localhost:5432/herald_e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["list"],
        ["json", { outputFile: "test-results/e2e-results.json" }],
        ["html", { outputFolder: "test-results/e2e-report", open: "never" }],
      ]
    : [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Typography is the one thing that differs between a Windows baseline
      // and the Linux CI runner. The style sheet below pins a metric-compatible
      // family; the ratios absorb sub-pixel text rasterisation.
      maxDiffPixelRatio: 0.02,
      threshold: 0.25,
      animations: "disabled",
      caret: "hide",
      stylePath: "tests/e2e/screenshot.css",
    },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 900 },
  },
  ...(local
    ? {
        webServer: {
          command: "bun run e2e:serve",
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: {
            DATABASE_URL: databaseUrl,
            E2E_DATABASE_URL: databaseUrl,
            BETTER_AUTH_URL: baseURL,
            BETTER_AUTH_SECRET:
              process.env.BETTER_AUTH_SECRET ??
              "e2e-only-secret-value-at-least-32-characters",
            FLAG_PUBLIC_FEEDBACK: "on",
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
      }
    : {}),
  projects: [
    {
      name: "e2e",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
