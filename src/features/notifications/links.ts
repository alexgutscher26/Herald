/**
 * Notification link anchors.
 *
 * A reply notification used to point at the request page, which left the
 * customer to find the new comment themselves. The anchor is derived from the
 * comment id so the public page, the in-app inbox and the widget all agree on
 * one fragment without storing a second URL.
 */

const COMMENT_ANCHOR_PREFIX = "comment-";

export function commentAnchorId(commentId: string): string {
  return `${COMMENT_ANCHOR_PREFIX}${commentId}`;
}

/**
 * Append `#comment-<id>` to an existing path, replacing any previous
 * fragment. Query strings are preserved.
 */
export function withCommentAnchor(href: string, commentId: string): string {
  const hashIndex = href.indexOf("#");
  const base = hashIndex === -1 ? href : href.slice(0, hashIndex);
  return `${base}#${commentAnchorId(commentId)}`;
}

export function hasCommentAnchor(href: string): boolean {
  return href.includes(`#${COMMENT_ANCHOR_PREFIX}`);
}
