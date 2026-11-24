import { expect, test } from "@playwright/test";

import { dashboardBase, expectDashboard, signIn } from "./helpers";

/**
 * The dashboard loop after a real credential sign-in: the product shell
 * opens, the seeded request is in the feedback list, and the seeded inbox
 * thread is reachable. Mostly read-only — the assignee change is a deliberate
 * browser write because Better Auth issues opaque string user ids and the
 * integration suite cannot cross the authenticated server-action boundary.
 * The e2e database is recreated for every run, so the write is isolated.
 */

test("a seeded owner reaches the dashboard, feedback and inbox", async ({ page }) => {
  await signIn(page);
  await expectDashboard(page);

  await page.getByRole("link", { name: "Feedback", exact: true }).first().click();
  await page.waitForURL(`${dashboardBase}/feedback`);
  // Rows select in place (the detail panel opens on the right); the title is
  // rendered as text, not as a link, so assert on the text.
  await expect(page.getByText(/Export every request as a CSV/).first()).toBeVisible();

  await page.getByRole("link", { name: "Inbox", exact: true }).first().click();
  await page.waitForURL(`${dashboardBase}/conversations`);
  await expect(page.getByText(/Exported CSV has stale rows/).first()).toBeVisible();
});

test("a seeded owner can assign a request to themselves", async ({ page }) => {
  await signIn(page);
  await expectDashboard(page);

  await page.getByRole("link", { name: "Feedback", exact: true }).first().click();
  await page.waitForURL(`${dashboardBase}/feedback`);
  await expect(page.getByText(/Export every request as a CSV/).first()).toBeVisible();

  // The first request is open in the detail panel; its assignee select is
  // server-validated against workspace membership.
  await page.locator("#request-assignee").click();
  await page.getByRole("option", { name: "E2E Owner" }).click();
  await expect(page.getByText("This request is yours.")).toBeVisible();
});

test("a signed-out dashboard visit goes through sign-in and back into the app", async ({
  page,
}) => {
  await page.goto(`${dashboardBase}/feedback`);

  await page.waitForURL((url) => url.pathname === "/sign-in", { timeout: 30_000 });
  // The auth middleware normalises protected deep links to the app root; the
  // redirect never points at an arbitrary URL supplied by the request.
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/app");

  await page.getByRole("textbox", { name: "Email", exact: true }).fill(
    "e2e@herald.test",
  );
  await page.getByLabel("Password", { exact: true }).fill("herald-e2e-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL((url) => url.pathname === "/app", { timeout: 30_000 });
  await page.goto(`${dashboardBase}/feedback`);
  await expect(page.getByText(/Dark mode for the dashboard/).first()).toBeVisible();
});
