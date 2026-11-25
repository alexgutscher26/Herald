import { describe, expect, test } from "bun:test";

import type { JunoSettings } from "@/db/schema/knowledge";
import { cosineSimilarity, hashEmbedding, LOCAL_EMBEDDING_MODEL } from "@/features/juno/embedding";
import {
  buildAnswerSystemPrompt,
  classifySensitiveQuestion,
  cleanAnswer,
  customerAskedForHuman,
  shouldPickup,
} from "@/features/juno/policy";
import { rankChunks } from "@/features/juno/rank";

const settings: JunoSettings = {
  productId: "00000000-0000-0000-0000-000000000000",
  enabled: true,
  duplicateMode: "assisted",
  submissionAssistantEnabled: false,
  tone: "direct",
  replyLength: "short",
  formality: "formal",
  emoji: false,
  language: "pt-BR",
  model: null,
  confidenceFloor: 0.35,
  dailyBudgetCents: 100,
  autoResolveChatMinutes: 30,
  autoResolveEmailMinutes: 4320,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("local embeddings", () => {
  test("are deterministic, normalized and similar to themselves", () => {
    const first = hashEmbedding("export a CSV from settings");
    const second = hashEmbedding("export a CSV from settings");
    expect(first).toEqual(second);
    expect(cosineSimilarity(first, second)).toBeCloseTo(1, 6);

    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(first).toHaveLength(256);
    expect(LOCAL_EMBEDDING_MODEL).toBe("herald-hash-v1");
  });

  test("unrelated text is less similar than a paraphrase", () => {
    const query = hashEmbedding("how do I export a csv");
    const related = hashEmbedding("open settings and export the CSV file");
    const unrelated = hashEmbedding("billing invoices and refunds");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );
  });

  test("cosine handles empty and mismatched vectors without throwing", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("retrieval ranking", () => {
  test("puts the chunk that shares the query terms first", () => {
    const query = "export csv";
    const embedding = hashEmbedding(query);
    const ranked = rankChunks(query, [
      {
        id: "billing",
        content: "Invoices and refunds are handled by the billing team.",
        embedding: hashEmbedding("Invoices and refunds are handled by the billing team."),
      },
      {
        id: "export",
        content: "Open Settings, choose Export, and download a CSV.",
        embedding: hashEmbedding("Open Settings, choose Export, and download a CSV."),
      },
    ], embedding);

    expect(ranked[0]?.chunk.id).toBe("export");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[0]?.lexical).toBe(1);
  });
});

describe("Mira behavior policy", () => {
  test("billing and account questions always hand off", () => {
    expect(classifySensitiveQuestion("Can I get a refund for the invoice?")).toBe("billing");
    expect(classifySensitiveQuestion("I need to change my password")).toBe("account");
    expect(classifySensitiveQuestion("Delete my account and data")).toBe("account");
    expect(classifySensitiveQuestion("How do I export a CSV?")).toBeNull();
  });

  test("detects a request for a human", () => {
    expect(customerAskedForHuman("Can I speak to a human please?")).toBe(true);
    expect(customerAskedForHuman("How do I invite a teammate?")).toBe(false);
  });

  test("only picks up a live, active thread whose latest message is from the customer", () => {
    const base = {
      enabled: true,
      status: "queue" as const,
      state: "active" as const,
      lastAuthor: "customer" as const,
      lastKind: "message" as const,
    };
    expect(shouldPickup(base).pickup).toBe(true);
    expect(shouldPickup({ ...base, enabled: false })).toEqual({
      pickup: false,
      reason: "disabled",
    });
    expect(shouldPickup({ ...base, lastAuthor: "team" })).toEqual({
      pickup: false,
      reason: "not_customer",
    });
    expect(shouldPickup({ ...base, lastKind: "note" })).toEqual({
      pickup: false,
      reason: "note",
    });
    expect(shouldPickup({ ...base, state: "paused" })).toEqual({
      pickup: false,
      reason: "state",
    });
    expect(shouldPickup({ ...base, state: "handed_off" })).toEqual({
      pickup: false,
      reason: "state",
    });
    expect(shouldPickup({ ...base, status: "resolved" })).toEqual({
      pickup: false,
      reason: "status",
    });
  });

  test("the system prompt carries tone, length, formality, language and guardrails", () => {
    const prompt = buildAnswerSystemPrompt(settings);
    expect(prompt).toContain("ONLY from the numbered knowledge sources");
    expect(prompt).toContain("Direct and concise");
    expect(prompt).toContain("at most two short sentences");
    expect(prompt).toContain("formal register");
    expect(prompt).toContain("pt-BR");
    expect(prompt).toContain("Do not use emoji");
    expect(prompt).toContain("Never claim to change settings, billing");
  });

  test("cleans model preambles and trailing citation markers", () => {
    expect(cleanAnswer("Answer: Open Settings. [1]")).toBe("Open Settings.");
    expect(cleanAnswer("  Keep me.  ")).toBe("Keep me.");
    expect(cleanAnswer("Use <b>Settings</b>.<br>Then save.")).toBe(
      "Use Settings.\nThen save.",
    );
    expect(cleanAnswer("Put it before `</body>`.")).toBe(
      "Put it before `</body>`.",
    );
  });
});
