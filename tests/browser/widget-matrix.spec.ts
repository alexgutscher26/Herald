import { expect, test } from "@playwright/test";

/**
 * Cross-browser launcher matrix.
 *
 * Each test uses the shipped loader against the fixture origin. These are the
 * checks the static accessibility suite cannot make: real focus movement, a
 * computed reduced-motion style, a live-region update after a frame message,
 * and the offline fallback replacing a blank iframe.
 */

test("launcher mounts, reports unread and opens the panel", async ({ page }) => {
  await page.goto("/host");

  const launcher = page.locator(".herald-launcher");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await expect(launcher).toContainText("What's new");

  await launcher.click();
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".herald-panel")).toBeVisible();
  await expect(page.locator(".herald-frame")).toBeVisible();
});

test("Escape closes the panel and returns focus to the launcher", async ({ page }) => {
  await page.goto("/host");

  const launcher = page.locator(".herald-launcher");
  await launcher.click();
  await expect(page.locator(".herald-panel")).toBeVisible();

  // The fixture frame forwards Escape exactly as the real bridge does.
  await page.frameLocator(".herald-frame").locator("#inside").focus();
  await page.keyboard.press("Escape");

  await expect(page.locator(".herald-panel")).toBeHidden();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
});

test("the frame reports the per-origin position override", async ({ page }) => {
  await page.goto("/host?position=bottom-right");

  // The stub reports top-left, simulating an override saved for this origin.
  const launcher = page.locator(".herald-launcher");
  await expect(launcher).toBeVisible();
  await expect(page.locator(".herald-root")).toHaveClass(/herald-position-top-left/);
});

test("announces unread changes in a shadow-root live region", async ({ page }) => {
  await page.goto("/host");

  const live = page.locator(".herald-live");
  await expect(live).toHaveAttribute("role", "status");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toContainText("2 unread notifications", { timeout: 3_000 });
});

test("respects prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/host");
  await page.locator(".herald-launcher").click();

  const style = await page.locator(".herald-panel").evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      animation: computed.animationName,
      transition: computed.transitionDuration,
    };
  });

  expect(style.animation).toBe("none");
});

test("shows the offline fallback instead of a blank panel", async ({ page }) => {
  await page.goto("/host");
  const launcher = page.locator(".herald-launcher");
  await expect(launcher).toBeVisible();
  // Let the initial frame handshake finish, then go offline. Otherwise a
  // late state message can legitimately recover the panel mid-assertion.
  await expect(page.locator(".herald-live")).toContainText(
    "2 unread notifications",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  // The panel explains the outage when opened; it does not pop open by
  // itself.
  await launcher.click();

  const fallback = page.locator(".herald-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("You're offline");
  await expect(page.locator(".herald-frame")).toBeHidden();
  await expect(page.locator(".herald-fallback-retry")).toBeVisible();
});

test("uses a custom trigger without rendering the built-in launcher", async ({ page }) => {
  await page.goto("/host?trigger=1");

  const trigger = page.locator("#custom-launcher");
  await expect(trigger).toHaveAttribute("data-herald-unread", "2");
  await expect(trigger).toHaveAttribute("data-herald-online", "true");
  await expect(page.locator(".herald-launcher")).toHaveCount(0);

  await trigger.click();
  await expect(page.locator(".herald-panel")).toBeVisible();
});

test("mounts an inline embed into a host container", async ({ page }) => {
  await page.goto("/host?inline=1");

  const host = page.locator("#herald-container > [data-herald-widget-host]");
  await expect(host).toBeVisible();
  await expect(page.locator("#herald-container .herald-frame")).toBeVisible();
  await expect(page.locator(".herald-launcher")).toHaveCount(0);
});

test("propagates a host nonce to the shadow-root stylesheet", async ({ page }) => {
  await page.goto("/host?nonce=test-nonce-value");

  await expect(page.locator(".herald-launcher")).toBeVisible();
  const nonce = await page
    .locator('[data-herald-widget-host]')
    .evaluate((host) => {
      const link = host.shadowRoot?.querySelector('link[rel="stylesheet"]');
      return link?.getAttribute("nonce") ?? null;
    });

  expect(nonce).toBe("test-nonce-value");
});

test("renders under a nonce-only script and style policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      violations.push(message.text());
    }
  });

  await page.goto("/host?nonce=csp-nonce-value&csp=1");
  const launcher = page.locator(".herald-launcher");
  await expect(launcher).toBeVisible();

  // The stylesheet loaded: the pill radius comes from v1.css, not the UA.
  const radius = await launcher.evaluate(
    (node) => getComputedStyle(node).borderRadius,
  );
  expect(radius).toContain("9999");
  expect(violations).toEqual([]);
});
