import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { toPublicComment, toPublicRequestSummary } from "@/features/public/serialize";

/**
 * Public pages may reuse presentational primitives, but never the dashboard's
 * data selectors, demo store or internal domain types. These guards fail if an
 * import quietly crosses that boundary.
 */

const ROOTS = ["src/features/public", "src/app/p"];

const FORBIDDEN = [
  { pattern: /from\s+["']@\/features\/live(?:\/|["'])/, reason: "dashboard snapshot/selectors" },
  { pattern: /from\s+["']@\/features\/feedback(?:\/|["'])/, reason: "internal feedback module" },
  { pattern: /from\s+["']@\/features\/demo(?:\/|["'])/, reason: "demo store" },
  { pattern: /from\s+["']@\/types["']/, reason: "dashboard domain types" },
];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(path);
  }

  return files;
}

describe("public surface boundaries", () => {
  test("public pages never import dashboard selectors, demo data or internal types", async () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of await sourceFiles(root)) {
        const source = await readFile(file, "utf8");
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(source)) {
            offenders.push(`${relative(process.cwd(), file)} imports ${rule.reason}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the request serializer emits only the public field list", () => {
    const summary = toPublicRequestSummary({
      id: "post-1",
      title: "A request",
      body: "Body",
      status: "planned",
      category: "feature_request",
      privacy: "public",
      authorLabel: "Ada",
      customerName: "Ada Lovelace",
      customerBannedAt: null,
      createdAt: new Date("2024-02-03T00:00:00.000Z"),
      updatedAt: new Date("2024-02-04T00:00:00.000Z"),
      voteCount: 7,
      commentCount: 2,
      tags: [{ name: "Enterprise", color: "#4f46e5" }],
      latestModeration: "approved",
      // Extra fields on the source must not pass through.
      authorEmail: "ada@example.test",
      internalNote: "Do not publish",
      hiddenAt: new Date(),
    } as Parameters<typeof toPublicRequestSummary>[0] & Record<string, unknown>);

    expect(Object.keys(summary).sort()).toEqual(
      [
        "authorName",
        "body",
        "category",
        "commentCount",
        "createdAt",
        "id",
        "privacy",
        "status",
        "tags",
        "title",
        "updatedAt",
        "voteCount",
      ].sort(),
    );
  });

  test("the comment serializer emits only the public comment fields", () => {
    const comment = toPublicComment({
      id: "comment-1",
      authorName: "Ada",
      authorType: "customer",
      body: "A reply",
      privacy: "public",
      createdAt: new Date("2024-02-03T00:00:00.000Z"),
      latestModeration: "approved",
      authorEmail: "ada@example.test",
      internal: true,
    } as Parameters<typeof toPublicComment>[0] & Record<string, unknown>);

    expect(Object.keys(comment).sort()).toEqual(
      ["authorName", "authorType", "body", "createdAt", "id", "isAuthor", "pending", "privacy"].sort(),
    );
  });
});
