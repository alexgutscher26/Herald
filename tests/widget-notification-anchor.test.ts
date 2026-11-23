import { describe, expect, test } from "bun:test";

import {
  commentAnchorId,
  hasCommentAnchor,
  withCommentAnchor,
} from "@/features/notifications/links";

describe("notification comment anchors", () => {
  const commentId = "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d";
  const href = `/p/acme/roadmap/requests/${commentId}`;

  test("appends the comment id as a fragment", () => {
    expect(withCommentAnchor(href, commentId)).toBe(
      `${href}#comment-${commentId}`,
    );
    expect(commentAnchorId(commentId)).toBe(`comment-${commentId}`);
  });

  test("replaces an existing fragment but keeps the query string", () => {
    expect(withCommentAnchor(`${href}?ref=email#top`, commentId)).toBe(
      `${href}?ref=email#comment-${commentId}`,
    );
  });

  test("detects a comment deep link", () => {
    expect(hasCommentAnchor(withCommentAnchor(href, commentId))).toBe(true);
    expect(hasCommentAnchor(href)).toBe(false);
    expect(hasCommentAnchor(`${href}#discussion`)).toBe(false);
  });
});
