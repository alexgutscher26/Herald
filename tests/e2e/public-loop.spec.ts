import { expect, test } from "@playwright/test";

import { acceptEssentialCookies, publicBoardPath } from "./helpers";

/**
 * The public loop: a board lists the seeded requests, and submitting a new
 * one from the form's own page puts it on the board.
 *
 * The board is seeded with moderation off, so the new request is visible
 * immediately; a pending request would prove less about the read path.
 */

test("public board renders the seeded requests", async ({ page }) => {
  await page.goto(publicBoardPath);

  await expect(page.getByRole("heading", { name: "Feedback" }).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Export every request as a CSV/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Dark mode for the dashboard/ }),
  ).toBeVisible();
});

test("a guest submission appears on the board", async ({ page }) => {
  const title = `E2E guest request ${Date.now().toString(36)}`;

  await page.goto(`${publicBoardPath}/submit`);
  await expect(page.getByRole("heading", { name: "Submit a request" })).toBeVisible();
  await acceptEssentialCookies(page);

  // The board is part of the URL, so the picker already targets the seeded one.
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Details").fill(
    "Submitted by the end-to-end suite. It should appear on the board immediately.",
  );

  await page.getByRole("button", { name: "Submit request", exact: true }).click();

  // A published request lands on its own receipt page inside the board.
  await page.waitForURL(
    (url) => url.pathname.startsWith(`${publicBoardPath}/`) && url.searchParams.has("submitted"),
    { timeout: 30_000 },
  );
  await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();

  await page.goto(publicBoardPath);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});
