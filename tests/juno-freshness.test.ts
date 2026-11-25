import { describe, expect, test } from "bun:test";

import {
  hasKnowledgeChange,
  summarizeKnowledgeChange,
} from "@/features/juno/diff";
import { resolveAnswerLanguage } from "@/features/juno/policy";

describe("knowledge recrawl diff", () => {
  test("counts added, removed and edited pages by URL", () => {
    const change = summarizeKnowledgeChange(
      [
        { url: "https://docs.test/a", title: "A", content: "one" },
        { url: "https://docs.test/b", title: "B", content: "two" },
      ],
      [
        { url: "https://docs.test/a", title: "A", content: "one changed" },
        { url: "https://docs.test/c", title: "C", content: "three" },
      ],
    );
    expect(change).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(hasKnowledgeChange(change)).toBe(true);
  });

  test("normalizes whitespace before calling a page edited", () => {
    const change = summarizeKnowledgeChange(
      [{ url: "https://docs.test/a", title: "A", content: "one  two" }],
      [{ url: "https://docs.test/a", title: "A", content: "one two" }],
    );
    expect(change).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(hasKnowledgeChange(change)).toBe(false);
  });

  test("falls back to the title when a page has no URL", () => {
    const change = summarizeKnowledgeChange(
      [],
      [{ url: null, title: "Uploaded PDF", content: "text" }],
    );
    expect(change.added).toBe(1);
  });
});

describe("Mira answer language", () => {
  test("workspace mode uses the configured public locale", () => {
    expect(resolveAnswerLanguage({ language: "workspace", workspaceLocale: "es" })).toBe(
      "es",
    );
  });

  test("workspace mode falls back to the customer when the locale is auto", () => {
    expect(resolveAnswerLanguage({ language: "workspace", workspaceLocale: "auto" })).toBe(
      "customer",
    );
    expect(resolveAnswerLanguage({ language: "workspace", workspaceLocale: null })).toBe(
      "customer",
    );
  });

  test("auto follows the customer and an explicit tag stays explicit", () => {
    expect(resolveAnswerLanguage({ language: "auto" })).toBe("customer");
    expect(resolveAnswerLanguage({ language: "pt-BR" })).toBe("pt-BR");
  });
});
