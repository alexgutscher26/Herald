import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string): Promise<string> {
  return readFile(path.join(process.cwd(), file), "utf8");
}

/**
 * Loader hardening contract.
 *
 * These are the checks a unit test can keep without a browser: the loader must
 * stay usable under a nonce-based host CSP, announce shadow-root state, honour
 * reduced motion, degrade instead of showing a blank panel, and accept the
 * per-origin override the embed route resolved. The behavioural browser pass
 * lives in tests/browser/widget-matrix.spec.ts.
 */

describe("widget loader hardening", () => {
  test("accepts a host nonce for the shadow-root stylesheet", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain('script.getAttribute("data-nonce")');
    expect(loader).toContain('link.setAttribute("nonce", scriptNonce)');
    // No inline style or script element is the reason a nonce is optional.
    expect(loader).not.toContain('createElement("style")');
  });

  test("announces unread and readiness through a shadow-root live region", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain('liveRegion.setAttribute("role", "status")');
    expect(loader).toContain('liveRegion.setAttribute("aria-live", "polite")');
    expect(loader).toContain("announce(");
    expect(loader).toContain("unread notifications");
    expect(loader).toContain("Widget ready");
  });

  test("honours prefers-reduced-motion in both CSS and script-driven scrolling", async () => {
    const loader = await source("public/widget/v1.js");
    const css = await source("public/widget/v1.css");

    expect(loader).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(loader).toContain('behavior: prefersReducedMotion() ? "auto" : "smooth"');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none");
    expect(css).toContain("transition: none");
  });

  test("degrades on offline, an unreachable frame and a blocked cookie jar", async () => {
    const loader = await source("public/widget/v1.js");
    const bridge = await source("src/features/widget/frame-bridge.tsx");
    const css = await source("public/widget/v1.css");

    expect(loader).toContain('showFallback("offline")');
    expect(loader).toContain('showFallback(navigator.onLine === false ? "offline" : "unreachable")');
    expect(loader).toContain('window.addEventListener("online", onBrowserOnline)');
    expect(loader).toContain('data.type === "degraded"');
    expect(loader).toContain('showFallback(data.reason === "cookies" ? "cookies" : "unreachable")');
    expect(loader).toContain("Open in a new tab");
    expect(bridge).toContain('type: "degraded"');
    expect(bridge).toContain("navigator.cookieEnabled");
    expect(css).toContain(".herald-fallback");
  });

  test("applies per-origin theme and position from the frame", async () => {
    const loader = await source("public/widget/v1.js");
    const bridge = await source("src/features/widget/frame-bridge.tsx");
    const embed = await source(
      "src/app/p/[workspaceSlug]/[productSlug]/embed/[[...panel]]/page.tsx",
    );

    expect(loader).toContain("readPositionOverride(data.position)");
    expect(loader).toContain("stateTheme = readTheme(data.theme)");
    expect(bridge).toContain("theme: string;");
    expect(bridge).toContain("position: string;");
    expect(bridge).toMatch(/theme,\s*\r?\n\s*position,/);
    expect(embed).toContain("resolveWidgetOriginOverride");
    expect(embed).toContain("launcherPosition");
    expect(embed).toContain("theme={theme}");
    expect(embed).toContain("position={launcherPosition}");
  });

  test("a proactive banner can open a panel, not only an external URL", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain("normalizePanel(copy.ctaPanel)");
    expect(loader).toContain("openWidget(ctaPanel)");
  });

  test("exposes the loader and handshake versions", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain('version: "v1"');
    expect(loader).toContain("protocol: 1");
    expect(loader).toContain("degraded: state.degraded");
  });
});
