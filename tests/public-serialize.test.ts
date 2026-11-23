import { describe, expect, test } from "bun:test";

import {
  isPublicCommentVisible,
  isPubliclyVisible,
  publicAuthorName,
  toPublicCategory,
  toPublicComment,
  toPublicRequestSummary,
  toPublicStatus,
  type PublicRequestSource,
} from "@/features/public/serialize";

const createdAt = new Date("2026-01-02T03:04:05.000Z");

function source(overrides: Partial<PublicRequestSource> = {}): PublicRequestSource {
  return {
    id: "request-1",
    title: "Dark mode",
    body: "Please add it.",
    status: "planned",
    category: "feature_request",
    privacy: "public",
    authorLabel: "Ada",
    customerName: null,
    customerBannedAt: null,
    createdAt,
    updatedAt: createdAt,
    voteCount: 4,
    commentCount: 2,
    tags: [{ name: "UI", color: "#fff" }],
    latestModeration: null,
    ...overrides,
  };
}

describe("public request serialization", () => {
  test("returns only the documented public fields", () => {
    const summary = toPublicRequestSummary(source());
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
    expect(summary.createdAt).toBe("2026-01-02T03:04:05.000Z");
    expect(summary.tags).toEqual([{ name: "UI", color: "#fff" }]);
  });

  test("prefers the customer name, then the label, then Anonymous", () => {
    expect(publicAuthorName({ customerName: "Grace", authorLabel: "Ada" })).toBe("Grace");
    expect(publicAuthorName({ customerName: null, authorLabel: "Ada" })).toBe("Ada");
    expect(publicAuthorName({ customerName: null, authorLabel: null })).toBe("Anonymous");
  });

  test("maps statuses and categories without leaking unknown values", () => {
    expect(toPublicStatus("in_progress")).toBe("in_progress");
    expect(toPublicStatus("declined")).toBe("closed");
    expect(toPublicStatus("something_else")).toBe("open");
    expect(toPublicCategory("bug")).toBe("bug");
    expect(toPublicCategory("other")).toBe("question");
  });
});

describe("public moderation visibility", () => {
  test("an unmoderated board shows everything except rejected content", () => {
    expect(isPubliclyVisible("none", null)).toBe(true);
    expect(isPubliclyVisible("none", "pending")).toBe(true);
    expect(isPubliclyVisible("none", "rejected")).toBe(false);
  });

  test("approval-required boards only show approved content", () => {
    expect(isPubliclyVisible("all", "pending")).toBe(false);
    expect(isPubliclyVisible("all", "approved")).toBe(true);
    expect(isPubliclyVisible("all", "rejected")).toBe(false);
    expect(isPubliclyVisible("first_time", "pending")).toBe(false);
    expect(isPubliclyVisible("first_time", "approved")).toBe(true);
  });

  test("moderated comments only show approved content", () => {
    expect(isPublicCommentVisible("moderated", null)).toBe(false);
    expect(isPublicCommentVisible("moderated", "pending")).toBe(false);
    expect(isPublicCommentVisible("moderated", "approved")).toBe(true);
  });

  test("open and closed comment policies keep existing visible comments", () => {
    expect(isPublicCommentVisible("open", null)).toBe(true);
    expect(isPublicCommentVisible("closed", "approved")).toBe(true);
    expect(isPublicCommentVisible("open", "rejected")).toBe(false);
  });
});

describe("public comment serialization", () => {
  test("maps author type and timestamp", () => {
    expect(
      toPublicComment({
        id: "comment-1",
        authorName: "Grace",
        authorType: "customer",
        body: "Same here",
        privacy: "public",
        createdAt,
        latestModeration: null,
      }),
    ).toEqual({
      id: "comment-1",
      authorName: "Grace",
      authorType: "customer",
      body: "Same here",
      privacy: "public",
      createdAt: "2026-01-02T03:04:05.000Z",
      pending: false,
      isAuthor: false,
    });
  });

  test("unknown author types are treated as team rather than leaking a value", () => {
    expect(
      toPublicComment({
        id: "comment-2",
        authorName: "Team",
        authorType: "system",
        body: "Shipped",
        privacy: "public",
        createdAt,
        latestModeration: null,
      }).authorType,
    ).toBe("team");
  });
});
