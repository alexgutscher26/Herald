import { expect, test } from "@playwright/test";

import {
  PRODUCT,
  WORKSPACE,
  acceptEssentialCookies,
  dashboardBase,
  freezeClock,
  publicBoardPath,
  signIn,
} from "./helpers";

/**
 * A deliberately small visual set: three stable, high-traffic surfaces.
 *
 * The clock is frozen before navigation so relative timestamps do not differ
 * between runs, and `tests/e2e/screenshot.css` pins a metric-compatible font
 * family. Baselines are generated with:
 *
 *   bun run e2e:visual --update-snapshots
 */

test.use({ viewport: { width: 1280, height: 900 } });

const HOST_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Host app</title></head>
  <body>
    <main style="font-family: Arial, sans-serif; padding: 40px">
      <h1>Host application</h1>
    </main>
    <script
      async
      id="herald-widget"
      src="/widget/v1.js"
      data-project="${WORKSPACE}/${PRODUCT}"
      data-position="bottom-right"
    ></script>
  </body>
</html>`;

test("dashboard shell", async ({ page }) => {
  await signIn(page);
  await acceptEssentialCookies(page);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("dashboard-shell.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    // Relative timestamps are the only genuinely time-dependent pixels.
    mask: [page.getByText(/^\d+[smhd] ago$/), page.getByText(/^just now$/)],
  });
});

test("public board", async ({ page }) => {
  await page.goto(publicBoardPath);
  await acceptEssentialCookies(page);
  await freezeClock(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Feedback" }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("public-board.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("widget launcher", async ({ page }) => {
  await freezeClock(page);
  await page.route("**/host-page", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }),
  );
  await page.goto("/host-page");
  await expect(page.locator(".herald-launcher")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("widget-launcher.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
