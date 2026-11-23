/**
 * Public conversation API paths for the widget.
 *
 * The `[conversationId]` routes read the workspace and product from the query
 * string, so a thread id must go into the path and the slugs must stay after
 * the `?`. Building both parts here keeps that ordering in one place.
 */
export function conversationStreamPath(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
}): string {
  const query = new URLSearchParams({
    workspaceSlug: input.workspaceSlug,
    productSlug: input.productSlug,
  });
  return `/api/public/conversations/${encodeURIComponent(
    input.conversationId,
  )}/stream?${query.toString()}`;
}

export function conversationApiPath(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId?: string;
  action?: "csat" | "feedback";
}): string {
  const query = new URLSearchParams({
    workspaceSlug: input.workspaceSlug,
    productSlug: input.productSlug,
  });
  const collection = input.conversationId
    ? `/api/public/conversations/${encodeURIComponent(input.conversationId)}`
    : "/api/public/conversations";
  const action = input.action ? `/${input.action}` : "";
  return `${collection}${action}?${query.toString()}`;
}
