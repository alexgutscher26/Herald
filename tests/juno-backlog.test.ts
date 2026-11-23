import { describe, expect, test } from "bun:test";

import { detectRequestedAgentAction } from "@/features/juno/agent-action-policy";
import {
  decideDuplicate,
  duplicateMatchScore,
  DUPLICATE_AUTO_MERGE_SCORE,
  DUPLICATE_SUGGESTION_FLOOR,
} from "@/features/juno/duplicate-policy";
import {
  MAX_REWRITE_SPLITS,
  parseRewriteResponse,
  RewriteFormatError,
} from "@/features/public/rewrite-prompt";

describe("duplicate linking policy", () => {
  const strong = { id: "target-1", title: "Dark mode", score: 0.92 };
  const uncertain = { id: "target-2", title: "Themes", score: 0.55 };

  test("off never reads or queues a match", () => {
    expect(decideDuplicate({ mode: "off", matches: [strong] })).toEqual({
      action: "none",
    });
  });

  test("assisted always queues, even a strong match", () => {
    expect(decideDuplicate({ mode: "assisted", matches: [strong] })).toEqual({
      action: "queue",
      match: strong,
      mode: "assisted",
    });
  });

  test("automatic merges only at the high-confidence line", () => {
    expect(
      decideDuplicate({
        mode: "automatic",
        matches: [{ ...strong, score: DUPLICATE_AUTO_MERGE_SCORE }],
      }),
    ).toEqual({
      action: "merge",
      match: { ...strong, score: DUPLICATE_AUTO_MERGE_SCORE },
      mode: "automatic",
    });
    expect(
      decideDuplicate({ mode: "automatic", matches: [uncertain] }),
    ).toEqual({
      action: "queue",
      match: uncertain,
      mode: "automatic",
    });
  });

  test("below the suggestion floor is not a duplicate", () => {
    expect(
      decideDuplicate({
        mode: "assisted",
        matches: [{ ...strong, score: DUPLICATE_SUGGESTION_FLOOR - 0.001 }],
      }),
    ).toEqual({ action: "none" });
  });

  test("the embedding score wins when a paraphrase shares no keywords", () => {
    expect(duplicateMatchScore(0.05, 0.62)).toBe(0.62);
    expect(duplicateMatchScore(0.55, 0.1)).toBe(0.55);
    expect(duplicateMatchScore(0.4, Number.NaN)).toBe(0.4);
    expect(duplicateMatchScore(Number.NaN, Number.NaN)).toBe(0);
  });

  test("chooses the highest finite score and ignores bad scores", () => {
    expect(
      decideDuplicate({
        mode: "assisted",
        matches: [
          uncertain,
          { ...strong, score: Number.NaN },
          { id: "winner", title: "Best", score: 0.7 },
        ],
      }),
    ).toMatchObject({
      action: "queue",
      match: { id: "winner", score: 0.7 },
    });
  });
});

describe("submission rewrite parser", () => {
  const valid = {
    title: "Add dark mode to the dashboard",
    body: "Please add a dark mode option to the dashboard.",
    splits: [
      {
        title: "Remember the selected theme",
        body: "Remember the chosen theme between sessions.",
      },
    ],
  };

  test("accepts a fenced JSON response", () => {
    const parsed = parseRewriteResponse(
      `Here is the result:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``,
    );
    expect(parsed.title).toBe(valid.title);
    expect(parsed.body).toBe(valid.body);
    expect(parsed.splits).toEqual(valid.splits);
  });

  test("drops a split that repeats the rewritten request", () => {
    const parsed = parseRewriteResponse(
      JSON.stringify({
        ...valid,
        splits: [
          { title: valid.title, body: valid.body },
          ...valid.splits,
        ],
      }),
    );
    expect(parsed.splits).toEqual(valid.splits);
  });

  test("caps splits at the declared maximum", () => {
    const splits = Array.from({ length: MAX_REWRITE_SPLITS + 2 }, (_, index) => ({
      title: `Separate request ${index}`,
      body: `This is separate request number ${index}.`,
    }));
    const parsed = parseRewriteResponse(JSON.stringify({ ...valid, splits }));
    expect(parsed.splits).toHaveLength(MAX_REWRITE_SPLITS);
  });

  test("rejects malformed or too-short output instead of applying it", () => {
    expect(() => parseRewriteResponse("not json")).toThrow(RewriteFormatError);
    expect(() =>
      parseRewriteResponse(JSON.stringify({ title: "No", body: "short" })),
    ).toThrow(RewriteFormatError);
  });
});

describe("literal action intent", () => {
  test("detects an explicit request to send a transcript", () => {
    expect(
      detectRequestedAgentAction("Please email me a transcript of this conversation"),
    ).toBe("send_transcript");
    expect(detectRequestedAgentAction("Can I get a copy of this chat?")).toBe(
      "send_transcript",
    );
  });

  test("does not infer an action from vague or unrelated wording", () => {
    expect(detectRequestedAgentAction("I need a transcript")).toBeNull();
    expect(detectRequestedAgentAction("How do I email a receipt?")).toBeNull();
    expect(
      detectRequestedAgentAction("Send this conversation to my manager"),
    ).toBeNull();
  });
});
