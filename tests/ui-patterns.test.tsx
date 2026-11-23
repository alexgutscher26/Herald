import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "@/components/shared/empty-state";
import { PageSkeleton } from "@/components/shared/page-skeleton";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** True when an `<EmptyState>` block still passes the removed badge prop. */
function emptyStateHasLabel(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/<EmptyState\b/.test(lines[index])) continue;
    const indent = (lines[index].match(/^\s*/) ?? [""])[0].length;
    for (let end = index + 1; end < lines.length; end += 1) {
      const endIndent = (lines[end].match(/^\s*/) ?? [""])[0].length;
      const closes =
        (/^\s*\/>/.test(lines[end]) || /^\s*<\/EmptyState>/.test(lines[end])) &&
        endIndent <= indent;
      if (!closes) continue;
      for (let line = index; line <= end; line += 1) {
        if (/^\s*label=/.test(lines[line])) return true;
      }
      break;
    }
  }
  return false;
}

describe("one empty-state pattern", () => {
  test("renders an icon, one sentence and one action without a status badge", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No boards yet"
        description="Create the first board to publish a public URL."
        action={<button type="button">New board</button>}
      />,
    );

    expect(html).toContain("No boards yet");
    expect(html).toContain("Create the first board to publish a public URL.");
    expect(html).toContain("New board");
    expect(html).toContain("<svg");
    expect(html).not.toContain("No data");
  });

  test("no caller passes the removed label badge", () => {
    const offenders = walk("src")
      .filter((path) => path.endsWith(".tsx"))
      .filter((path) => emptyStateHasLabel(read(path)));

    expect(offenders).toEqual([]);
  });
});

describe("one loading pattern", () => {
  test("is sized to content and announced", () => {
    const html = renderToStaticMarkup(<PageSkeleton variant="list" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading…");
  });

  test("every route loading file uses the shared skeleton", () => {
    const loadingFiles = walk("src/app").filter((path) => path.endsWith("loading.tsx"));
    expect(loadingFiles.length).toBeGreaterThan(0);
    for (const path of loadingFiles) {
      expect(read(path)).toContain("@/components/shared/page-skeleton");
    }
  });
});

describe("one error pattern", () => {
  test("every route error boundary uses the shared error state", () => {
    const errorFiles = walk("src/app").filter(
      (path) => path.endsWith("error.tsx") || path.endsWith("global-error.tsx"),
    );
    expect(errorFiles.length).toBeGreaterThan(0);
    for (const path of errorFiles) {
      const source = read(path);
      if (path.endsWith("global-error.tsx")) {
        // The root layout failure may leave no stylesheet; this boundary keeps
        // the same actions with inline styles instead of the shared component.
        expect(source).toContain("buildSupportHref");
        expect(source).toContain("Contact support");
      } else {
        expect(source).toContain("@/components/shared/error-state");
      }
    }
  });

  test("the support form reads prefilled subject and body", () => {
    const source = read("src/features/portal/support-form.tsx");
    expect(source).toContain("initialSubject");
    expect(source).toContain("initialBody");
    expect(source).toContain("subject");
    expect(source).toContain("body");
  });
});

describe("one destructive-action pattern", () => {
  test("typed confirmation is available only through the shared dialog", () => {
    const dialog = read("src/components/shared/confirm-dialog.tsx");
    expect(dialog).toContain("confirmText");
    expect(dialog).toContain("disabled={!confirmed}");
  });

  test("workspace-level deletion still re-checks the typed name on the server", () => {
    const action = read("src/features/data-controls/actions.ts");
    expect(action).toContain("confirmName");
  });

  test("account deletion uses the shared dialog, not a second typed phrase", () => {
    const source = read("src/components/auth/delete-account-card.tsx");
    expect(source).toContain("ConfirmDialog");
    expect(source).not.toContain("delete-account-confirmation");
  });
});
