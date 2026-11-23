import { describe, expect, test } from "bun:test";

import {
  DETAIL_SIMILAR_LIMIT,
  DETAIL_SIMILAR_MIN_SCORE,
  excerpt,
  rankSimilar,
  similarityScore,
  tokenize,
} from "@/features/public/similarity";

describe("tokenize", () => {
  test("lowercases, drops stopwords, short words and duplicates", () => {
    expect(tokenize("Add Dark mode to the editor, please. Dark mode!")).toEqual([
      "add",
      "dark",
      "mode",
      "editor",
    ]);
  });

  test("caps the number of tokens", () => {
    const words = Array.from({ length: 40 }, (_, index) => `word${index}`);
    expect(tokenize(words.join(" ")).length).toBeLessThanOrEqual(24);
  });
});

describe("similarityScore", () => {
  test("scores near-identical requests highly", () => {
    const score = similarityScore(
      { title: "Dark mode", body: "Please add a dark theme to the editor." },
      { title: "Dark mode", body: "Dark theme for the editor would help." },
    );
    expect(score).toBeGreaterThan(0.4);
  });

  test("scores unrelated requests low", () => {
    const score = similarityScore(
      { title: "Dark mode", body: "Please add a dark theme." },
      { title: "Export invoices", body: "I need a CSV export for invoices." },
    );
    expect(score).toBe(0);
  });

  test("title words count more than body words", () => {
    const query = { title: "Billing export", body: "" };
    const titleMatch = similarityScore(query, {
      title: "Billing export",
      body: "Unrelated text entirely",
    });
    const bodyOnly = similarityScore(query, {
      title: "Something else",
      body: "Billing export appears only here",
    });

    expect(titleMatch).toBeGreaterThan(bodyOnly);
  });

  test("returns zero for empty input", () => {
    expect(similarityScore({ title: "", body: "" }, { title: "Dark mode", body: "" })).toBe(0);
  });
});

describe("rankSimilar", () => {
  const candidates = [
    { id: "a", title: "Dark mode", body: "A dark theme." },
    { id: "b", title: "Export invoices", body: "CSV export." },
    { id: "c", title: "Dark mode for mobile", body: "Mobile theme." },
  ];

  test("orders by score and drops weak matches", () => {
    const ranked = rankSimilar({ title: "Dark mode", body: "" }, candidates, {
      limit: 5,
    });

    expect(ranked.map((candidate) => candidate.id)).toEqual(["a", "c"]);
  });

  test("respects exclusions and the limit", () => {
    const ranked = rankSimilar({ title: "Dark mode", body: "" }, candidates, {
      limit: 1,
      excludeIds: ["a"],
    });

    expect(ranked.map((candidate) => candidate.id)).toEqual(["c"]);
  });

  test("applies a stricter minimum on the request page", () => {
    expect(DETAIL_SIMILAR_LIMIT).toBe(3);
    expect(DETAIL_SIMILAR_MIN_SCORE).toBeGreaterThan(0.12);

    const ranked = rankSimilar({ title: "Dark mode", body: "" }, candidates, {
      limit: DETAIL_SIMILAR_LIMIT,
      minScore: 0.99,
    });
    expect(ranked).toEqual([]);
  });
});

describe("excerpt", () => {
  test("collapses whitespace and truncates with an ellipsis", () => {
    expect(excerpt("one\n\ntwo   three")).toBe("one two three");
    expect(excerpt("abcdefghij", 6)).toBe("abcde…");
  });
});
