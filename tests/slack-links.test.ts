import { describe, expect, test } from "bun:test";

import { parseHeraldRequestUrl } from "@/features/slack/links";

describe("Slack Herald links", () => {
  test("parses canonical public request URLs and the legacy path", () => {
    const canonical = parseHeraldRequestUrl(
      "https://feedback.example.com/p/acme/roadmap/ideas/5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
      "https://feedback.example.com",
    );
    expect(canonical).toEqual({
      workspaceSlug: "acme",
      productSlug: "roadmap",
      boardSlug: "ideas",
      requestId: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
    });

    expect(
      parseHeraldRequestUrl(
        "https://feedback.example.com/p/acme/roadmap/ideas/requests/5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
        "https://feedback.example.com",
      )?.requestId,
    ).toBe("5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f");
  });

  test("rejects another origin, other paths and malformed encoding", () => {
    expect(
      parseHeraldRequestUrl(
        "https://lookalike.example.com/p/acme/roadmap/ideas/request-1",
        "https://feedback.example.com",
      ),
    ).toBeNull();
    expect(
      parseHeraldRequestUrl("https://feedback.example.com/api/v1/requests/1", "https://feedback.example.com"),
    ).toBeNull();
    expect(
      parseHeraldRequestUrl("https://feedback.example.com/p/acme/roadmap/%E0%A4%A/request-1", "https://feedback.example.com"),
    ).toBeNull();
  });
});
