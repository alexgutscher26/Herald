import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * The import page polls a dedicated progress route. Only the upload route
 * existed once, so the UI silently showed no progress; this guard ties the
 * client path to a real, authorized, uncached GET handler.
 */

const ROUTE =
  "src/app/api/app/[workspaceSlug]/[productSlug]/imports/[importId]/route.ts";
const VIEW = "src/features/import/import-view.tsx";

describe("import progress endpoint", () => {
  test("the route the page polls exists and reads a scoped import", () => {
    expect(existsSync(ROUTE)).toBe(true);
    const source = readFileSync(ROUTE, "utf8");

    expect(source).toContain("export async function GET");
    expect(source).toContain("authorizeAppApi");
    expect(source).toContain('permission: "settings:manage"');
    expect(source).toContain("getFeedbackImport");
    expect(source).toContain("no-store");
    expect(source).toContain("uuidSchema.safeParse(importId)");
  });

  test("the client polls the same nested path", () => {
    const source = readFileSync(VIEW, "utf8");
    expect(source).toContain("/imports/${encodeURIComponent(importId)}");
  });
});
