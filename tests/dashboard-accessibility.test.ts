import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * Dashboard accessibility contract.
 *
 * The criterion-by-criterion record is docs/accessibility-audit-dashboard.md.
 * These tests protect the parts that should not regress: bypass, route and
 * dialog focus, live announcements, the roadmap keyboard alternative, contrast
 * handling, reduced motion, form errors, target size, image alt text and the
 * public statement. Browser and screen-reader passes remain manual and are not
 * claimed by this suite.
 */

async function source(file: string): Promise<string> {
  return readFile(file, "utf8");
}

describe("dashboard accessibility structure", () => {
  test("the app shell has a bypass link, focusable main and route focus manager", async () => {
    const shell = await source("src/components/layout/app-shell.tsx");
    const routeFocus = await source("src/components/layout/route-focus.tsx");

    expect(shell).toContain('href="#dashboard-content"');
    expect(shell).toContain('id="dashboard-content"');
    expect(shell).toContain("Skip to content");
    expect(shell).toContain("tabIndex={-1}");
    expect(shell).toContain("RouteFocusManager");
    expect(shell).toContain("LiveAnnouncerProvider");
    expect(shell).toContain("data-dashboard");

    expect(routeFocus).toContain("usePathname");
    expect(routeFocus).toContain('main.querySelector<HTMLElement>("h1")');
    expect(routeFocus).toContain("target.focus(");
  });

  test("dialogs rely on Radix focus containment and return focus to the trigger", async () => {
    const dialog = await source("src/components/ui/dialog.tsx");
    const sheet = await source("src/components/ui/sheet.tsx");

    for (const primitive of [dialog, sheet]) {
      expect(primitive).toContain("@radix-ui/react-dialog");
      // Radix restores focus on close. A custom onCloseAutoFocus that moved focus
      // elsewhere would silently break the return path.
      expect(primitive).not.toContain("onCloseAutoFocus");
    }
    expect(dialog).toContain("DialogPrimitive.Content");
    expect(sheet).toContain("SheetPrimitive.Content");

    // The palette also opens from a global shortcut, where Radix has no
    // pointer trigger to restore. It owns the return path explicitly.
    const palette = await source("src/components/layout/command-palette.tsx");
    expect(palette).toContain("<DialogTrigger asChild>");
    expect(palette).toContain("restoreFocusOnClose");
    expect(palette).toContain("triggerNode.focus()");
    expect(palette).toContain('document.querySelector(\'[role="dialog"]\')');
  });

  test("the roadmap has a labelled keyboard status menu and announces the move", async () => {
    const roadmap = await source("src/features/roadmap/roadmap-view.tsx");

    expect(roadmap).toContain('htmlFor={`roadmap-status-${post.id}`}');
    expect(roadmap).toContain("Move {post.title} to another status");
    expect(roadmap).toContain('id={`roadmap-status-${post.id}`}');
    expect(roadmap).toContain('aria-describedby="roadmap-instructions"');
    expect(roadmap).toContain('id="roadmap-instructions"');
    expect(roadmap).toContain("announce(");
    expect(roadmap).toContain("Moved ${post.title} to");
  });

  test("async inbox, thread and widget updates have live announcements", async () => {
    const announcer = await source("src/features/accessibility/live-announcer.tsx");
    const inbox = await source("src/features/conversations/conversations-view.tsx");
    const thread = await source("src/features/conversations/thread-view.tsx");
    const widget = await source("src/features/widget/messages-view.tsx");

    expect(announcer).toContain('role="status"');
    expect(announcer).toContain('aria-live="polite"');
    expect(announcer).toContain('role="alert"');
    expect(announcer).toContain('aria-live="assertive"');

    expect(inbox).toContain("knownUnread");
    expect(inbox).toContain("new conversation");
    expect(inbox).toContain("announce(");
    expect(thread).toContain('role="log"');
    expect(thread).toContain('aria-live="polite"');

    expect(widget).toContain("knownMessageIds");
    expect(widget).toContain("unread message");
    expect(widget).toContain('role="log"');
    expect(widget).toContain('aria-live="polite"');
  });

  test("dashboard and widget respect reduced motion", async () => {
    const globals = await source("src/app/globals.css");
    const widget = await source("public/widget/v1.css");

    expect(globals).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globals).toContain("animation-duration: 0.01ms !important");
    expect(globals).toContain("transition-duration: 0.01ms !important");
    expect(widget).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("form errors are associated with their inputs", async () => {
    const files = [
      "src/features/public/submit-form.tsx",
      "src/features/public/comment-form.tsx",
      "src/features/public/identify-form.tsx",
      "src/features/customer-auth/login-form.tsx",
      "src/features/widget/messages-view.tsx",
      "src/features/subscribers/subscribers-view.tsx",
      "src/features/roadmap/roadmap-manager.tsx",
    ];

    for (const file of files) {
      const text = await source(file);
      expect(text, `${file} has no aria-describedby`).toContain("aria-describedby");
      expect(text, `${file} has no aria-invalid`).toContain("aria-invalid");
      expect(text, `${file} has no alert region`).toMatch(/role="alert"/);
    }

    const form = await source("src/components/ui/form.tsx");
    expect(form).toContain("formMessageId");
    expect(form).toContain("aria-invalid={!!error}");
  });

  test("controls meet the 24 px target at mobile widths", async () => {
    const globals = await source("src/app/globals.css");

    expect(globals).toContain("@media (max-width: 767px)");
    expect(globals).toContain("min-height: 24px");
    expect(globals).toContain("min-width: 24px");
  });

  test("uploaded inline images require alternative text before insertion", async () => {
    const editor = await source("src/features/releases/release-editor.tsx");
    const dialog = await source("src/features/releases/inline-image-alt-dialog.tsx");
    const images = await source("src/features/releases/inline-images.ts");

    expect(editor).toContain("InlineImageAltDialog");
    expect(editor).toContain("setPendingInlineImages");
    expect(editor).toContain("inlineImageMarkdownWithAlt");

    expect(dialog).toContain("Describe the images you added");
    expect(dialog).toContain("Alternative text");
    expect(dialog).toContain("disabled={!complete}");
    expect(dialog).toContain("aria-invalid={value.trim().length === 0}");

    expect(images).toContain("sanitizeInlineImageAlt");
    expect(images).toContain("inlineImageMarkdownWithAlt");
  });

  test("the accessibility statement is published and linked from the trust surfaces", async () => {
    const page = await source("src/app/accessibility/page.tsx");
    const shell = await source("src/components/trust/legal-shell.tsx");
    const sitemap = await source("src/app/sitemap.ts");
    const landing = await source("src/features/marketing/landing-page.tsx");
    const marketing = await source("src/features/marketing/marketing-chrome.tsx");

    expect(page).toContain("WCAG 2.2 Level AA");
    expect(page).toContain("Known limitations");
    expect(page).toContain("ACCESSIBILITY_CONTACT");
    expect(shell).toContain('href: "/accessibility"');
    expect(sitemap).toContain('path: "/accessibility"');
    expect(landing).toContain('href: "/accessibility"');
    expect(marketing).toContain('href: "/accessibility"');
  });

  test("analytics and operations use table headers and text labels", async () => {
    const analytics = await source(
      "src/app/(dashboard)/app/[workspaceSlug]/[productSlug]/analytics/page.tsx",
    );
    expect(analytics).toContain("aria-label");
    expect(analytics).toContain("Current status funnel");

    const operations = await source(
      "src/app/(dashboard)/app/[workspaceSlug]/[productSlug]/operations/page.tsx",
    );
    expect(operations).toContain("<thead");
    expect(operations).toContain("Recent jobs");
  });

  test("settings gives destructive data controls visible text, not icon-only actions", async () => {
    const settings = await source(
      "src/features/workspace-settings/workspace-settings-view.tsx",
    );
    expect(settings).toContain("Request deletion");
    expect(settings).toContain("Cancel deletion");
    expect(settings).toContain("Export workspace JSON");
    expect(settings).toContain("Customer email to erase");
  });

  test("the dashboard audit record covers the requested criteria", async () => {
    const audit = await source("docs/accessibility-audit-dashboard.md");

    for (const criterion of [
      "1.1.1",
      "1.3.1",
      "1.4.3",
      "2.1.1",
      "2.4.1",
      "2.4.3",
      "2.4.7",
      "2.5.8",
      "3.3.1",
      "3.3.2",
      "4.1.2",
      "4.1.3",
    ]) {
      expect(audit, `audit misses ${criterion}`).toContain(criterion);
    }
    expect(audit).toContain("NVDA");
    expect(audit).toContain("VoiceOver");
  });
});
