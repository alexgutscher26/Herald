/**
 * The single route manifest for `/api/v1`.
 *
 * The router, the served OpenAPI document and the MCP parity test all read
 * this list. A route that is not declared here is not part of the public
 * contract, and the OpenAPI document cannot advertise a path this file does
 * not name.
 *
 * Paths use OpenAPI's `{parameter}` spelling so they can be copied straight
 * into the document. `resource` narrows a read-only token: a token with
 * `feedback:read` may GET feedback routes but not support routes, while the
 * legacy `read` scope keeps its workspace-wide meaning.
 */

export type ApiHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type ApiReadResource = "feedback" | "support";

export type ApiRouteDefinition = {
  method: ApiHttpMethod;
  path: string;
  operationId: string;
  /** Resource a resource-specific read scope unlocks; `null` accepts any read. */
  resource: ApiReadResource | null;
};

export const API_ROUTE_DEFINITIONS: readonly ApiRouteDefinition[] = [
  { method: "GET", path: "/", operationId: "getApiRoot", resource: null },

  { method: "GET", path: "/boards", operationId: "listBoards", resource: "feedback" },
  { method: "POST", path: "/boards", operationId: "createBoard", resource: "feedback" },
  { method: "GET", path: "/boards/{board_id}", operationId: "getBoard", resource: "feedback" },
  {
    method: "PATCH",
    path: "/boards/{board_id}",
    operationId: "updateBoard",
    resource: "feedback",
  },

  { method: "GET", path: "/tags", operationId: "listTags", resource: "feedback" },
  { method: "POST", path: "/tags", operationId: "createTag", resource: "feedback" },
  { method: "DELETE", path: "/tags/{tag_id}", operationId: "deleteTag", resource: "feedback" },

  {
    method: "GET",
    path: "/custom-fields",
    operationId: "listCustomFields",
    resource: "feedback",
  },
  {
    method: "POST",
    path: "/custom-fields",
    operationId: "createCustomField",
    resource: "feedback",
  },
  {
    method: "GET",
    path: "/custom-fields/{field_id}",
    operationId: "getCustomField",
    resource: "feedback",
  },
  {
    method: "PATCH",
    path: "/custom-fields/{field_id}",
    operationId: "updateCustomField",
    resource: "feedback",
  },
  {
    method: "DELETE",
    path: "/custom-fields/{field_id}",
    operationId: "deleteCustomField",
    resource: "feedback",
  },

  { method: "GET", path: "/requests", operationId: "listRequests", resource: "feedback" },
  { method: "POST", path: "/requests", operationId: "createRequest", resource: "feedback" },
  {
    method: "GET",
    path: "/requests/{request_id}",
    operationId: "getRequest",
    resource: "feedback",
  },
  {
    method: "PATCH",
    path: "/requests/{request_id}",
    operationId: "updateRequest",
    resource: "feedback",
  },
  {
    method: "GET",
    path: "/requests/{request_id}/brief",
    operationId: "getRequestBrief",
    resource: "feedback",
  },
  {
    method: "GET",
    path: "/requests/{request_id}/comments",
    operationId: "listComments",
    resource: "feedback",
  },
  {
    method: "POST",
    path: "/requests/{request_id}/comments",
    operationId: "createComment",
    resource: "feedback",
  },
  {
    method: "POST",
    path: "/requests/{request_id}/votes",
    operationId: "voteOnRequest",
    resource: "feedback",
  },
  {
    method: "DELETE",
    path: "/requests/{request_id}/votes",
    operationId: "removeVote",
    resource: "feedback",
  },

  {
    method: "GET",
    path: "/changelogs",
    operationId: "listChangelog",
    resource: "feedback",
  },
  {
    method: "POST",
    path: "/changelogs",
    operationId: "createChangelogDraft",
    resource: "feedback",
  },
  {
    method: "GET",
    path: "/changelogs/{release_id}",
    operationId: "getChangelog",
    resource: "feedback",
  },
  {
    method: "PATCH",
    path: "/changelogs/{release_id}",
    operationId: "updateChangelogDraft",
    resource: "feedback",
  },

  { method: "GET", path: "/members", operationId: "listMembers", resource: null },

  { method: "GET", path: "/companies", operationId: "listCompanies", resource: "support" },
  { method: "POST", path: "/companies", operationId: "createCompany", resource: "support" },
  {
    method: "GET",
    path: "/companies/{company_id}",
    operationId: "getCompany",
    resource: "support",
  },
  {
    method: "PATCH",
    path: "/companies/{company_id}",
    operationId: "updateCompany",
    resource: "support",
  },
  {
    method: "POST",
    path: "/companies/{company_id}/customers",
    operationId: "addCompanyCustomer",
    resource: "support",
  },

  {
    method: "GET",
    path: "/conversations",
    operationId: "listConversations",
    resource: "support",
  },
  {
    method: "GET",
    path: "/conversations/{conversation_id}",
    operationId: "getConversation",
    resource: "support",
  },
  {
    method: "PATCH",
    path: "/conversations/{conversation_id}",
    operationId: "updateConversation",
    resource: "support",
  },
  {
    method: "GET",
    path: "/conversations/{conversation_id}/messages",
    operationId: "listMessages",
    resource: "support",
  },
  {
    method: "POST",
    path: "/conversations/{conversation_id}/messages",
    operationId: "replyToConversation",
    resource: "support",
  },
  {
    method: "POST",
    path: "/conversations/{conversation_id}/notes",
    operationId: "addConversationNote",
    resource: "support",
  },

  { method: "POST", path: "/events", operationId: "trackCustomerEvent", resource: null },
] as const;

/** Compare a declared path template with actual router segments. */
export function matchesApiPath(
  template: string,
  segments: readonly string[],
): boolean {
  const parts = template.split("/").filter((part) => part.length > 0);
  if (parts.length !== segments.length) return false;
  return parts.every((part, index) =>
    part.startsWith("{") ? (segments[index]?.length ?? 0) > 0 : part === segments[index],
  );
}

/**
 * Is this path declared for at least one method?
 *
 * The router calls this before dispatch. A new route that is added to the
 * switch but not to the manifest therefore answers 404 instead of quietly
 * existing outside the published contract.
 */
export function apiPathIsDeclared(segments: readonly string[]): boolean {
  return API_ROUTE_DEFINITIONS.some((route) => matchesApiPath(route.path, segments));
}

/** Resource bucket for a GET route, sourced from the same manifest. */
export function readResourceForSegments(
  segments: readonly string[],
): ApiReadResource | null {
  const route = API_ROUTE_DEFINITIONS.find(
    (item) => item.method === "GET" && matchesApiPath(item.path, segments),
  );
  return route?.resource ?? null;
}
