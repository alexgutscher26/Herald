import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { en } from "@/features/public/i18n/messages/en";
import { es } from "@/features/public/i18n/messages/es";

/**
 * Widget accessibility contract.
 *
 * The launcher lives in a shadow root and the panels live in an iframe, so the
 * checks that are cheap to keep are structural: dialog wiring and labels, the
 * Escape path on both sides of the frame boundary, focus moving into the panel
 * and staying there while it is open, and the panel chrome (skip-link target,
 * nav labels, `aria-current`). Behavioural checks are exercised in the browser
 * and recorded in docs/widget-browser-smoke.md.
 */

async function source(file: string): Promise<string> {
  return readFile(path.join(process.cwd(), file), "utf8");
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("widget launcher accessibility", () => {
  test("the launcher advertises and owns a dialog", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain('setAttribute("aria-haspopup", "dialog")');
    expect(loader).toContain(
      'button.setAttribute("aria-controls", "herald-widget-panel")',
    );
    expect(loader).toContain(
      'button.setAttribute("aria-expanded", expanded ? "true" : "false")',
    );
    expect(loader).toContain(
      'customTrigger.setAttribute("aria-expanded", expanded ? "true" : "false")',
    );
    expect(loader).toContain('panel.setAttribute("role", "dialog")');
    expect(loader).toContain('panel.setAttribute("aria-modal", "false")');
    expect(loader).toContain('panel.setAttribute("aria-label", label)');
    expect(loader).toContain("frame.title = label");
  });

  test("the launcher label states the unread count and decoration is hidden", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain('label + ", " + unread');
    expect(loader).toContain('dot.setAttribute("aria-hidden", "true")');
    expect(loader).toContain('labelNode.className = "herald-launcher-label"');
  });

  test("Escape closes the panel and focus moves in and back out", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain(
      'event.key === "Escape" && state.open && !state.inline',
    );
    expect(loader).toContain("frame.focus();");

    const close = between(loader, "function closeWidget()", "function toggleWidget(");
    expect(close).toContain("var target = customTrigger || button;");
    expect(close).toContain("target.focus();");
  });

  test("focus that lands on the page behind the panel returns to the frame", async () => {
    const loader = await source("public/widget/v1.js");

    const handler = between(
      loader,
      "function onDocumentFocusIn(event)",
      "function onDocumentPointerDown(event)",
    );
    expect(handler).toContain("!state.open || state.inline");
    expect(handler).toContain("frame.focus();");

    expect(loader).toContain('document.addEventListener("focusin", onDocumentFocusIn)');
    expect(loader).toContain(
      'document.removeEventListener("focusin", onDocumentFocusIn)',
    );
  });

  test("the launcher has a visible focus ring", async () => {
    const css = await source("public/widget/v1.css");

    expect(css).toContain(".herald-launcher:focus-visible");
    expect(css).toContain("outline:");
  });

  test("the launcher only applies validated brand colours", async () => {
    const loader = await source("public/widget/v1.js");
    const bridge = await source("src/features/widget/frame-bridge.tsx");

    expect(loader).toContain("readAccent(data.accent)");
    expect(loader).toContain('root.style.setProperty("--herald-accent"');
    expect(bridge).toContain("accent: accentColor");
    expect(bridge).toContain("accentFg: accentForeground");
  });
});

describe("widget panel accessibility", () => {
  test("the panel forwards Escape and contains Tab", async () => {
    const bridge = await source("src/features/widget/frame-bridge.tsx");

    expect(bridge).toContain('postToParent(targetOrigin, { type: "close" })');
    expect(bridge).toContain('event.key !== "Tab"');
    expect(bridge).toContain("last.focus();");
    expect(bridge).toContain("first.focus();");
  });

  test("only the floating panel contains Tab", async () => {
    const bridge = await source("src/features/widget/frame-bridge.tsx");
    const loader = await source("public/widget/v1.js");

    // The loader tells the frame which mode it is in; the bridge traps only
    // when the frame is not an inline embed that is part of the page.
    expect(loader).toContain('type: "mode", inline: state.inline');
    expect(bridge).toContain('event.data.type === "mode"');
    expect(bridge).toContain(
      "containedRef.current = event.data.inline !== true",
    );
    expect(bridge).toContain("if (!containedRef.current) return;");
  });

  test("the close control is labelled in both locales", async () => {
    const bridge = await source("src/features/widget/frame-bridge.tsx");
    expect(bridge).toContain("aria-label={label}");

    expect(en["widget.close"]).toBe("Close widget");
    expect(es["widget.close"]).toBe("Cerrar widget");
    expect(en["widget.nav"]).toBeTruthy();
    expect(es["widget.nav"]).toBeTruthy();
  });

  test("the panel main answers the inherited skip link", async () => {
    const shell = await source("src/features/widget/shell.tsx");
    const layout = await source("src/app/p/[workspaceSlug]/layout.tsx");

    expect(layout).toContain('href="#public-main"');
    expect(shell).toContain('id="public-main"');
    expect(shell).toContain("tabIndex={-1}");
    expect(shell).toContain("lang={locale}");
  });

  test("the panel nav is labelled and marks the current tab", async () => {
    const shell = await source("src/features/widget/shell.tsx");

    expect(shell).toContain('aria-label={t("widget.nav")}');
    expect(shell).toContain('aria-current={current ? "page" : undefined}');
  });
});
