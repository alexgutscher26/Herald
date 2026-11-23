import { describe, expect, test } from "bun:test";

import {
  conversationApiPath,
  conversationStreamPath,
} from "@/features/widget/conversations-api";

const threadId = "07a32c65-9caf-46d4-8436-b854ba59f60c";

describe("widget conversation api paths", () => {
  test("listing conversations keeps both slugs in the query string", () => {
    expect(conversationApiPath({ workspaceSlug: "test12", productSlug: "changelog" })).toBe(
      "/api/public/conversations?workspaceSlug=test12&productSlug=changelog",
    );
  });

  test("a thread id is part of the path, never part of productSlug", () => {
    const path = conversationApiPath({
      workspaceSlug: "test12",
      productSlug: "changelog",
      conversationId: threadId,
    });
    const url = new URL(path, "https://example.test");

    expect(url.pathname).toBe(`/api/public/conversations/${threadId}`);
    expect(url.searchParams.get("productSlug")).toBe("changelog");
    expect(url.searchParams.get("workspaceSlug")).toBe("test12");
  });

  test("csat and feedback keep the thread path and the same query string", () => {
    for (const action of ["csat", "feedback"] as const) {
      const path = conversationApiPath({
        workspaceSlug: "test12",
        productSlug: "changelog",
        conversationId: threadId,
        action,
      });
      const url = new URL(path, "https://example.test");

      expect(url.pathname).toBe(`/api/public/conversations/${threadId}/${action}`);
      expect(url.searchParams.get("workspaceSlug")).toBe("test12");
      expect(url.searchParams.get("productSlug")).toBe("changelog");
    }
  });

  test("the stream path keeps the thread id in the path and slugs in the query", () => {
    const path = conversationStreamPath({
      workspaceSlug: "test12",
      productSlug: "changelog",
      conversationId: threadId,
    });
    const url = new URL(path, "https://example.test");

    expect(url.pathname).toBe(`/api/public/conversations/${threadId}/stream`);
    expect(url.searchParams.get("workspaceSlug")).toBe("test12");
    expect(url.searchParams.get("productSlug")).toBe("changelog");
  });

  test("slugs with reserved characters stay a single query value", () => {
    const path = conversationApiPath({
      workspaceSlug: "test 12",
      productSlug: "help/center",
      conversationId: threadId,
    });
    const url = new URL(path, "https://example.test");

    expect(url.searchParams.get("workspaceSlug")).toBe("test 12");
    expect(url.searchParams.get("productSlug")).toBe("help/center");
    expect(path).not.toContain("help/center");
  });
});
