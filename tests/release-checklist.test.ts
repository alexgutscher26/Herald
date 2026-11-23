import { describe, expect, test } from "bun:test";

import { releaseChecklist } from "@/features/releases/checklist";

describe("release publishing checklist", () => {
  test("passes every soft check for a complete entry", () => {
    const items = releaseChecklist({
      title: "Faster search and better filters",
      summary: "Search now matches partial words and surfaces recent results first.",
      linkedFeedbackCount: 2,
      cover: { kind: "preset", preset: "grid" },
    });

    expect(items.every((item) => item.passed)).toBe(true);
  });

  test("warns without blocking when content or a linked request is missing", () => {
    const items = releaseChecklist({
      title: "Small",
      summary: "Too short",
      linkedFeedbackCount: 0,
      cover: { kind: "none" },
    });

    expect(items.filter((item) => !item.passed).map((item) => item.id)).toEqual([
      "title",
      "summary",
      "linked-request",
      "og-image",
    ]);
    expect(items.find((item) => item.id === "og-image")?.detail).toContain(
      "social image",
    );
  });

  test("treats an uploaded cover as a social image", () => {
    const items = releaseChecklist({
      title: "A complete release title",
      summary: "A complete summary that explains the customer benefit clearly.",
      linkedFeedbackCount: 1,
      cover: { kind: "custom", key: "workspaces/abc/image.png" },
    });

    expect(items.find((item) => item.id === "og-image")?.passed).toBe(true);
  });
});
