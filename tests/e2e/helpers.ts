import { expect, type Page } from "@playwright/test";

/** Must match `scripts/e2e/seed.ts`. */
export const WORKSPACE = "herald-e2e";
export const PRODUCT = "herald";
export const BOARD = "feedback";
export const EMAIL = "e2e@herald.test";
export const PASSWORD = "herald-e2e-password";

export const publicBoardPath = `/p/${WORKSPACE}/${PRODUCT}/${BOARD}`;
export const dashboardBase = `/app/${WORKSPACE}/${PRODUCT}`;

/** Dismiss the consent banner so it cannot cover the control under test. */
export async function acceptEssentialCookies(page: Page): Promise<void> {
  const essential = page.getByRole("button", { name: "Essential only", exact: true });
  if (await essential.isVisible().catch(() => false)) {
    await essential.click();
  }
}

/** Sign in through the real form; the session cookie is Better Auth's. */
export async function signIn(page: Page, redirectTo = dashboardBase): Promise<void> {
  await page.goto(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith(redirectTo), {
    timeout: 30_000,
  });
}

/**
 * Pin `Date.now()` so relative timestamps in a screenshot do not drift.
 *
 * `setFixedTime` deliberately leaves timers alone: installing and pausing the
 * full clock stalls Better Auth and React, which both schedule work.
 */
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00.000Z"));
}

/** The dashboard shell is ready when its navigation landmark is visible. */
export async function expectDashboard(page: Page): Promise<void> {
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Feedback", exact: true }).first()).toBeVisible();
}
