import { describe, expect, test } from "bun:test";

import {
  inlineImageAlt,
  inlineImageMarkdown,
  inlineImagePath,
  insertMarkdownBlock,
  isInlineImageKey,
  preserveInlineImageReferences,
} from "@/features/releases/inline-images";

const KEY =
  "workspaces/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/image/33333333-3333-4333-8333-333333333333.png";

describe("inline release images", () => {
  test("accepts only generated image keys in the product scope", () => {
    expect(isInlineImageKey(KEY)).toBe(true);
    expect(isInlineImageKey(KEY.replace("/image/", "/cover/"))).toBe(false);
    expect(isInlineImageKey(KEY.replace("/image/", "/attachment/"))).toBe(false);
    expect(isInlineImageKey("data:image/png;base64,AAAA")).toBe(false);
    expect(isInlineImageKey("../image/escape.png")).toBe(false);
  });

  test("builds a stable same-origin path instead of a data URL", () => {
    expect(inlineImagePath(KEY)).toBe(
      "/api/release-images/workspaces/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/image/33333333-3333-4333-8333-333333333333.png",
    );
    expect(inlineImageMarkdown(KEY, "Search [results].png")).toBe(
      "![Search results](/api/release-images/workspaces/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/image/33333333-3333-4333-8333-333333333333.png)",
    );
  });

  test("keeps alt text single-line and free of Markdown brackets", () => {
    expect(inlineImageAlt("a\n[b]\\c.png")).toBe("a b c");
    expect(inlineImageAlt("   ")).toBe("Release image");
  });

  test("keeps an uploaded image when a rewrite omits it", () => {
    const image = `![Search results](${inlineImagePath(KEY)})`;
    const original = `### What changed\n\n${image}\n\n- Search is faster.`;
    const rewritten = "### What changed\n\nSearch now matches partial words.";

    expect(preserveInlineImageReferences(original, rewritten)).toBe(
      `${rewritten}\n\n${image}`,
    );
    expect(preserveInlineImageReferences(original, `${rewritten}\n\n${image}`)).toBe(
      `${rewritten}\n\n${image}`,
    );
  });

  test("inserts an image as its own Markdown block at the caret", () => {
    expect(insertMarkdownBlock("Before after", "![x](/image.png)", 7, 7)).toEqual({
      value: "Before \n\n![x](/image.png)\n\nafter",
      caret: 27,
    });
    expect(insertMarkdownBlock("", "![x](/image.png)", 0, 0)).toEqual({
      value: "![x](/image.png)",
      caret: 16,
    });
  });
});
