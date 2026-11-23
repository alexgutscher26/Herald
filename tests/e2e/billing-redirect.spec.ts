import { expect, test } from "@playwright/test";

import { WORKSPACE, signIn } from "./helpers";

/**
 * A plan-limit toast links to `/app/{workspace}/settings#billing`. A signed-out
 * visitor must survive that deep link: sign in, land back on settings, and see
 * the billing section. This is the redirect the billing module promises; it
 * does not start a Stripe session, so no provider credentials are needed.
 */

const billingPath = `/app/${WORKSPACE}/settings#billing`;
const settingsPath = `/app/${WORKSPACE}/settings`;

test("a billing deep link signs in and reaches the billing section", async ({ page }) => {
  await page.goto(billingPath);

  await page.waitForURL((url) => url.pathname === "/sign-in", { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/app");

  await page.getByRole("textbox", { name: "Email", exact: true }).fill(
    "e2e@herald.test",
  );
  await page.getByLabel("Password", { exact: true }).fill("herald-e2e-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL((url) => url.pathname === "/app", { timeout: 30_000 });

  // The billing link carried by a plan-limit toast lands here once signed in.
  await page.goto(billingPath);
  await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText(/Current: Pro/)).toBeVisible();
});

test("an already signed-in owner can open billing directly", async ({ page }) => {
  await signIn(page, settingsPath);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await page.goto(billingPath);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
});
