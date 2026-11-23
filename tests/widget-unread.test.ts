import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Unread badge refresh contract.
 *
 * The panels are server-rendered, so the launcher's count can only change if
 * something tells it to. These checks pin the three halves of that path: the
 * frame re-reads a session-scoped count, it reports only real changes to the
 * launcher, and opening the panel asks for a fresh read instead of waiting for
 * the next poll. The HTTP behaviour is covered in
 * tests/integration/widget-embed.test.ts.
 */

async function source(file: string): Promise<string> {
  return readFile(path.join(process.cwd(), file), "utf8");
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("widget unread badge", () => {
  test("the panel re-reads a session-scoped count instead of reloading", async () => {
    const bridge = await source("src/features/widget/frame-bridge.tsx");

    expect(bridge).toContain("/api/public/notifications/unread");
    expect(bridge).toContain('credentials: "same-origin"');
    expect(bridge).toContain('cache: "no-store"');
    expect(bridge).toContain("UNREAD_REFRESH_MS");
    expect(bridge).toContain(
      'document.addEventListener("visibilitychange", onVisible)',
    );
    expect(bridge).toContain('window.addEventListener("focus", onVisible)');
  });

  test("a changed count is reported to the launcher as state", async () => {
    const bridge = await source("src/features/widget/frame-bridge.tsx");
    const refresh = between(
      bridge,
      "async function refreshUnread()",
      "refreshRef.current =",
    );

    expect(refresh).toContain("if (next === knownUnread) return;");
    expect(refresh).toContain('type: "state"');
    expect(refresh).toContain("unread: next");
  });

  test("opening the panel asks the frame for a fresh count", async () => {
    const loader = await source("public/widget/v1.js");
    const open = between(
      loader,
      "function openWidget(panelPath)",
      "function closeWidget()",
    );
    const bridge = await source("src/features/widget/frame-bridge.tsx");

    expect(open).toContain("requestUnreadRefresh();");
    expect(loader).toContain('type: "refresh"');
    expect(bridge).toContain('event.data.type === "refresh"');
    expect(bridge).toContain("refreshRef.current();");
  });

  test("the launcher exposes the reported count through its label and trigger", async () => {
    const loader = await source("public/widget/v1.js");

    expect(loader).toContain('label + ", " + unread');
    expect(loader).toContain('customTrigger.setAttribute("data-herald-unread"');
  });
});
