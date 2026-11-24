import { expect, test } from "@playwright/test";

import { PRODUCT, WORKSPACE } from "./helpers";

/**
 * The widget as a customer installs it: one script tag on a host page, with a
 * `data-project` pair. The loader is the shipped `public/widget/v1.js`, and
 * the panel iframe is the real `/p/{workspace}/{product}/embed` page, so this
 * covers the install contract rather than a component in isolation.
 */

const HOST_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Host app</title></head>
  <body>
    <main><h1>Host application</h1></main>
    <script
      async
      id="herald-widget"
      src="/widget/v1.js"
      data-project="${WORKSPACE}/${PRODUCT}"
      data-position="bottom-right"
    ></script>
  </body>
</html>`;

test("the loader mounts a launcher and opens the embed panel", async ({ page }) => {
  await page.route("**/host-page", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }),
  );
  await page.goto("/host-page");

  const launcher = page.locator(".herald-launcher");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");

  await launcher.click();
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await expect(launcher).toBeHidden();
  const panel = page.locator(".herald-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("bottom", "20px");

  const frame = page.frameLocator(".herald-frame");
  await expect(frame.locator("body")).toBeVisible();
  await expect(
    frame.getByText("Powered by Herald", { exact: true }),
  ).toBeVisible();

  // A first visit can show the cookie notice over the widget's bottom tabs;
  // clear it before trying to reach the navigation.
  const essential = frame.getByRole("button", { name: "Essential only", exact: true });
  if (await essential.isVisible().catch(() => false)) await essential.click();

  // The panel opens on What's new; the Feedback tab is the public board.
  await frame.getByRole("link", { name: "Feedback", exact: true }).click();

  await expect(
    frame.getByRole("link", { name: /Export every request as a CSV/ }),
  ).toBeVisible({ timeout: 30_000 });

  // The launcher is part of the closed state only; closing the panel brings it
  // back with the expected collapsed accessibility state.
  await frame.getByRole("button", { name: "Close widget" }).click();
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});
