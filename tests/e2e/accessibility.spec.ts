import { expect, test, type Page } from "@playwright/test";

import {
  PRODUCT,
  WORKSPACE,
  acceptEssentialCookies,
  dashboardBase,
  expectDashboard,
  publicBoardPath,
  signIn,
} from "./helpers";

/**
 * Browser evidence for the dashboard and public accessibility work.
 *
 * This is a real Chromium keyboard and layout pass, not an NVDA/VoiceOver run.
 * The assistive-technology pass and the visual 200%/400% checks remain manual
 * and are recorded in docs/accessibility-audit-dashboard.md.
 */

const CONTROL_SELECTOR =
  'button, [role="button"], summary, select, input[type="checkbox"], input[type="radio"]';

async function mobileTargetViolations(page: Page): Promise<string[]> {
  await page.setViewportSize({ width: 360, height: 800 });
  return page.evaluate((selector) => {
    const violations: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        element.closest('[aria-hidden="true"]') ||
        element.hasAttribute("disabled")
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 23.5 || rect.height < 23.5) {
        const label =
          element.getAttribute("aria-label")?.trim() ||
          element.textContent?.trim().slice(0, 40) ||
          element.tagName.toLowerCase();
        violations.push(`${label}: ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`);
      }
    }
    return violations;
  }, CONTROL_SELECTOR);
}

test("dashboard: skip link, route and dialog focus, roadmap menu and mobile targets", async ({
  page,
}) => {
  await signIn(page);
  await expectDashboard(page);

  // The bypass link is the first tab stop and moves focus to the main landmark.
  await page.goto(dashboardBase);
  await expectDashboard(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#dashboard-content")).toBeFocused();

  // A keyboard-activated route change lands on the new page heading.
  const feedbackLink = page.getByRole("link", { name: "Feedback", exact: true }).first();
  await feedbackLink.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`${dashboardBase}/feedback`);
  await expect(page.locator("#dashboard-content h1").first()).toBeFocused();

  // The command palette opens from the keyboard, puts focus in its search
  // field, and restores the element that opened it when Escape closes it.
  const paletteTrigger = page.getByRole("button", {
    name: "Search (Command K)",
  });
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  await expect(palette).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search workspace" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(paletteTrigger).toBeFocused();

  // The shortcut is a toggle, so closing with Ctrl K must restore focus too.
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeHidden();
  await expect(paletteTrigger).toBeFocused();

  // The drag-and-drop roadmap has a native, focusable status menu on each
  // card, with the instructions attached as its description.
  await page.goto(`${dashboardBase}/roadmap`);
  const roadmapSelect = page
    .getByRole("combobox", { name: /Move Export every request as a CSV to another status/ })
    .first();
  await expect(roadmapSelect).toBeVisible();
  await expect(roadmapSelect).toHaveAttribute("aria-describedby", "roadmap-instructions");
  await expect(page.locator("#roadmap-instructions")).toContainText("use the status menu");
  await roadmapSelect.focus();
  await expect(roadmapSelect).toBeFocused();
  await expect(roadmapSelect).toHaveJSProperty("tabIndex", 0);

  expect(await mobileTargetViolations(page)).toEqual([]);
});

test("public: accessible labels, file-error association and mobile targets", async ({ page }) => {
  await page.goto(publicBoardPath);
  await expect(page.locator("main h1")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator('a[href="#public-main"]')).toBeFocused();

  await page.goto(`${publicBoardPath}/submit`);
  await acceptEssentialCookies(page);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("#submit-title")).toBeVisible();
  await expect(page.locator("#submit-body")).toBeVisible();

  const fileInput = page.locator("#submit-files");
  await fileInput.setInputFiles(
    Array.from({ length: 11 }, (_, index) => ({
      name: `request-${index}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("attachment"),
    })),
  );
  await expect(fileInput).toHaveAttribute("aria-invalid", "true");
  await expect(fileInput).toHaveAttribute("aria-describedby", "submit-file-error");
  await expect(page.locator("#submit-file-error")).toHaveAttribute("role", "alert");

  expect(await mobileTargetViolations(page)).toEqual([]);
});

test("reduced motion applies to the dashboard and the embedded widget", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await expectDashboard(page);

  const dashboardMotion = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>("[data-dashboard] button");
    if (!button) return null;
    const style = window.getComputedStyle(button);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
      scrollBehavior: window.getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
  expect(dashboardMotion).not.toBeNull();
  expect(Number.parseFloat(dashboardMotion!.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(dashboardMotion!.transitionDuration)).toBeLessThanOrEqual(0.001);
  expect(dashboardMotion!.scrollBehavior).toBe("auto");

  // Mount the shipped loader on a real public page. The loader reads the
  // project from its data attributes exactly as a customer install does.
  await page.goto(publicBoardPath);
  await page.evaluate((project) => {
    const script = document.createElement("script");
    script.async = true;
    script.id = "herald-widget";
    script.src = "/widget/v1.js";
    script.dataset.project = project;
    script.dataset.position = "bottom-right";
    document.body.append(script);
  }, `${WORKSPACE}/${PRODUCT}`);
  const launcher = page.locator(".herald-launcher");
  await expect(launcher).toBeVisible();

  const launcherMotion = await launcher.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      animation: style.animationName,
      transitionDuration: style.transitionDuration,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(launcherMotion.animation).toBe("none");
  expect(Number.parseFloat(launcherMotion.transitionDuration)).toBe(0);
  expect(launcherMotion.width).toBeGreaterThanOrEqual(24);
  expect(launcherMotion.height).toBeGreaterThanOrEqual(24);

  await launcher.focus();
  await expect(launcher).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(".herald-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator(".herald-frame")).toBeVisible();
  const panelMotion = await panel.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      animation: style.animationName,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(panelMotion.animation).toBe("none");
  expect(Number.parseFloat(panelMotion.transitionDuration)).toBe(0);
});
