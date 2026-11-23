/**
 * MCP tool catalog.
 *
 * Tools are thin descriptors over `/api/v1`: each one builds the same request a
 * REST client would send, and the MCP route dispatches it through the v1
 * router. Validation, scopes, idempotency, tenant isolation and moderation are
 * therefore identical for agents and for HTTP clients.
 *
 * The catalog is pure so it can be unit-tested without a database.
 */

export const MCP_SERVER_NAME = "herald";
export const MCP_SERVER_TITLE = "Herald";
export const MCP_SERVER_VERSION = "1.0.0";

/** Newest first. `initialize` echoes a supported version; newer clients may skip it. */
export const MCP_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export const MCP_DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export type McpToolCall = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string> | undefined;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  build: (args: Record<string, unknown>) => McpToolCall;
};

export class McpToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolArgumentError";
  }
}

// ---------------------------------------------------------------------------
// JSON Schema helpers
// ---------------------------------------------------------------------------

const string = (description?: string) => ({
  type: "string",
  ...(description ? { description } : {}),
});
const uuid = (description = "UUID") => ({ type: "string", format: "uuid", description });
const integer = (description: string, minimum = 0, maximum = 10_000) => ({
  type: "integer",
  minimum,
  maximum,
  description,
});
const bool = (description: string) => ({ type: "boolean", description });
const enumeration = (values: readonly string[], description: string) => ({
  type: "string",
  enum: [...values],
  description,
});
const arrayOf = (items: unknown, description: string) => ({
  type: "array",
  items,
  description,
});
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
  description?: string,
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  ...(description ? { description } : {}),
});

const idempotency = () => ({
  idempotency_key: {
    type: "string",
    minLength: 8,
    maxLength: 255,
    description:
      "Retry-safe key. Repeating the same call with the same key returns the first response for the deployment's idempotency TTL (24 hours by default).",
  },
});

const customer = object({
  id: uuid("Existing customer UUID."),
  external_id: string("Your system's customer id; preferred identity."),
  email: { type: "string", format: "email", description: "Customer email." },
  name: string("Display name, used when creating a customer."),
});

const status = enumeration(
  ["open", "under_review", "planned", "in_progress", "shipped", "closed"],
  "Feedback status.",
);
const category = enumeration(
  ["feature_request", "bug", "improvement", "question"],
  "Request category.",
);
const sort = enumeration(
  ["newest", "oldest", "updated", "votes"],
  "Sort order; a cursor is bound to it.",
);
const limit = integer("Page size, 1–100.", 1, 100);
const cursor = string("Opaque cursor from pagination.next_cursor.");

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpToolArgumentError(`\`${key}\` is required.`);
  }
  return value;
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function query(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function idempotencyHeaders(args: Record<string, unknown>): Record<string, string> | undefined {
  const key = args.idempotency_key;
  if (key === undefined) return undefined;
  if (typeof key !== "string" || key.length < 8 || key.length > 255) {
    throw new McpToolArgumentError(
      "`idempotency_key` must be 8–255 characters of letters, digits, dot, colon, underscore or hyphen.",
    );
  }
  return { "Idempotency-Key": key };
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_boards",
    title: "List boards",
    description: "List the workspace's feedback boards, newest or by position.",
    readOnly: true,
    inputSchema: object({
      sort: enumeration(["position", "name", "newest"], "Board sort."),
      include_archived: bool("Include archived boards."),
    }),
    build: (args) => ({
      method: "GET",
      path: `/boards${query({ sort: args.sort, include_archived: args.include_archived })}`,
    }),
  },
  {
    name: "create_board",
    title: "Create board",
    description:
      "Create a feedback board on a product. The slug defaults to a slugified name.",
    readOnly: false,
    inputSchema: object(
      {
        product_id: uuid("Product that owns the board."),
        name: string("Board name."),
        slug: string("Optional URL slug."),
        description: string("Optional description."),
        visibility: enumeration(["public", "private"], "Board visibility."),
        guest_posting: bool("Allow requests without an account."),
        position: integer("Display order.", 0, 10_000),
      },
      ["product_id", "name"],
    ),
    build: (args) => ({
      method: "POST",
      path: "/boards",
      body: compact({
        product_id: args.product_id,
        name: args.name,
        slug: args.slug,
        description: args.description,
        visibility: args.visibility,
        guest_posting: args.guest_posting,
        position: args.position,
      }),
    }),
  },
  {
    name: "list_requests",
    title: "List requests",
    description:
      "Search and page feedback requests. Archived, hidden and merged duplicates are excluded by default.",
    readOnly: true,
    inputSchema: object({
      status,
      board: string("Board id or slug."),
      tag: string("Tag id or name."),
      author: string("Customer id, external id or email."),
      updated_since: string("ISO 8601 timestamp."),
      q: string("Free-text search."),
      sort,
      limit,
      cursor,
      include_archived: bool("Include archived requests."),
      include_merged: bool("Include requests merged into another."),
    }),
    build: (args) => ({
      method: "GET",
      path: `/requests${query({
        status: args.status,
        board: args.board,
        tag: args.tag,
        author: args.author,
        updated_since: args.updated_since,
        q: args.q,
        sort: args.sort,
        limit: args.limit,
        cursor: args.cursor,
        include_archived: args.include_archived,
        include_merged: args.include_merged,
      })}`,
    }),
  },
  {
    name: "get_request",
    title: "Get request",
    description: "Read one request with its author, tags and counts.",
    readOnly: true,
    inputSchema: object({ request_id: uuid("Request UUID.") }, ["request_id"]),
    build: (args) => ({
      method: "GET",
      path: `/requests/${segment(text(args, "request_id"))}`,
    }),
  },
  {
    name: "get_request_brief",
    title: "Get request brief",
    description:
      "Read one request as a deterministic Markdown brief: problem, evidence with sources and dates, demand, current status and open questions. Internal notes and author emails are never included.",
    readOnly: true,
    inputSchema: object({ request_id: uuid("Request UUID.") }, ["request_id"]),
    build: (args) => ({
      method: "GET",
      path: `/requests/${segment(text(args, "request_id"))}/brief`,
    }),
  },
  {
    name: "create_request",
    title: "Create request",
    description:
      "Create feedback. Without `customer` the token's creator is the author; with `customer` the board's moderation policy still applies.",
    readOnly: false,
    inputSchema: object(
      {
        board_id: uuid("Board to file the request on."),
        title: string("Short title, 3–200 characters."),
        body: string("Request body."),
        category,
        status,
        tag_ids: arrayOf(uuid(), "Tags from the same board."),
        customer,
        ...idempotency(),
      },
      ["board_id", "title", "body"],
    ),
    build: (args) => ({
      method: "POST",
      path: "/requests",
      headers: idempotencyHeaders(args),
      body: compact({
        board_id: args.board_id,
        title: args.title,
        body: args.body,
        category: args.category,
        status: args.status,
        tag_ids: args.tag_ids,
        customer: args.customer,
      }),
    }),
  },
  {
    name: "update_request",
    title: "Update request",
    description: "Change a request's title, body, category, status, tags or visibility.",
    readOnly: false,
    inputSchema: object(
      {
        request_id: uuid("Request UUID."),
        title: string("New title."),
        body: string("New body."),
        category,
        status,
        tag_ids: arrayOf(uuid(), "Replacement tag set."),
        hidden: bool("Hide or restore the request."),
      },
      ["request_id"],
    ),
    build: (args) => ({
      method: "PATCH",
      path: `/requests/${segment(text(args, "request_id"))}`,
      body: compact({
        title: args.title,
        body: args.body,
        category: args.category,
        status: args.status,
        tag_ids: args.tag_ids,
        hidden: args.hidden,
      }),
    }),
  },
  {
    name: "list_comments",
    title: "List comments",
    description: "Read a request's timeline, including internal team notes.",
    readOnly: true,
    inputSchema: object(
      {
        request_id: uuid("Request UUID."),
        sort: enumeration(["oldest", "newest"], "Comment sort."),
        limit,
        cursor,
      },
      ["request_id"],
    ),
    build: (args) => ({
      method: "GET",
      path: `/requests/${segment(text(args, "request_id"))}/comments${query({
        sort: args.sort,
        limit: args.limit,
        cursor: args.cursor,
      })}`,
    }),
  },
  {
    name: "create_comment",
    title: "Reply to request",
    description:
      "Add a public reply (notifies followers) or, with internal=true, a team-only note.",
    readOnly: false,
    inputSchema: object(
      {
        request_id: uuid("Request UUID."),
        body: string("Comment text."),
        internal: bool("Store as an internal note instead of a customer-visible reply."),
        ...idempotency(),
      },
      ["request_id", "body"],
    ),
    build: (args) => ({
      method: "POST",
      path: `/requests/${segment(text(args, "request_id"))}/comments`,
      headers: idempotencyHeaders(args),
      body: compact({ body: args.body, internal: args.internal }),
    }),
  },
  {
    name: "vote_request",
    title: "Vote on request",
    description: "Cast or withdraw a customer's vote and return the new count.",
    readOnly: false,
    inputSchema: object(
      {
        request_id: uuid("Request UUID."),
        customer,
        voted: bool("false withdraws the vote."),
      },
      ["request_id", "customer"],
    ),
    build: (args) => {
      const requestId = segment(text(args, "request_id"));
      if (args.voted === false) {
        const identity = (args.customer ?? {}) as Record<string, unknown>;
        return {
          method: "DELETE",
          path: `/requests/${requestId}/votes${query({
            customer_id: identity.id,
            external_id: identity.external_id,
            email: identity.email,
          })}`,
        };
      }
      return {
        method: "POST",
        path: `/requests/${requestId}/votes`,
        body: { customer: args.customer, voted: true },
      };
    },
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "List board tags, optionally for one board or product.",
    readOnly: true,
    inputSchema: object({
      board: string("Board id or slug."),
      product: string("Product id or slug."),
    }),
    build: (args) => ({
      method: "GET",
      path: `/tags${query({ board: args.board, product: args.product })}`,
    }),
  },
  {
    name: "create_tag",
    title: "Create tag",
    description: "Create a tag on a board.",
    readOnly: false,
    inputSchema: object(
      {
        board_id: uuid("Board UUID."),
        name: string("Tag name."),
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Hex colour." },
      },
      ["board_id", "name"],
    ),
    build: (args) => ({
      method: "POST",
      path: "/tags",
      body: compact({ board_id: args.board_id, name: args.name, color: args.color }),
    }),
  },
  {
    name: "delete_tag",
    title: "Delete tag",
    description: "Delete a board tag and its links.",
    readOnly: false,
    inputSchema: object({ tag_id: uuid("Tag UUID.") }, ["tag_id"]),
    build: (args) => ({ method: "DELETE", path: `/tags/${segment(text(args, "tag_id"))}` }),
  },
  {
    name: "list_changelogs",
    title: "List changelog entries",
    description: "List drafts, scheduled and published changelog entries.",
    readOnly: true,
    inputSchema: object({
      status: enumeration(["draft", "scheduled", "published", "archived"], "Entry status."),
      tag: string("Tag name."),
      updated_since: string("ISO 8601 timestamp."),
      q: string("Free-text search."),
      sort: enumeration(["newest", "oldest", "updated"], "Entry sort."),
      limit,
      cursor,
    }),
    build: (args) => ({
      method: "GET",
      path: `/changelogs${query({
        status: args.status,
        tag: args.tag,
        updated_since: args.updated_since,
        q: args.q,
        sort: args.sort,
        limit: args.limit,
        cursor: args.cursor,
      })}`,
    }),
  },
  {
    name: "create_changelog",
    title: "Create changelog draft",
    description:
      "Create a changelog entry. It is always a draft; there is no publish action on the API.",
    readOnly: false,
    inputSchema: object(
      {
        product_id: uuid("Product UUID."),
        title: string("Entry title."),
        slug: string("URL slug."),
        summary: string("Short summary."),
        body: string("Markdown body."),
        category: enumeration(["feature", "improvement", "fix"], "Entry category."),
        tags: arrayOf(string(), "Tag names."),
        authorIds: arrayOf(string(), "Team user ids to credit."),
        linkedFeedbackIds: arrayOf(uuid(), "Shipped request ids."),
        ...idempotency(),
      },
      ["product_id", "title", "slug"],
    ),
    build: (args) => ({
      method: "POST",
      path: "/changelogs",
      headers: idempotencyHeaders(args),
      body: compact({
        product_id: args.product_id,
        title: args.title,
        slug: args.slug,
        summary: args.summary,
        body: args.body,
        category: args.category,
        tags: args.tags,
        authorIds: args.authorIds,
        linkedFeedbackIds: args.linkedFeedbackIds,
      }),
    }),
  },
  {
    name: "get_changelog",
    title: "Get changelog entry",
    description: "Read one changelog entry.",
    readOnly: true,
    inputSchema: object({ release_id: uuid("Changelog entry UUID.") }, ["release_id"]),
    build: (args) => ({
      method: "GET",
      path: `/changelogs/${segment(text(args, "release_id"))}`,
    }),
  },
  {
    name: "list_members",
    title: "List members",
    description: "List the workspace's team members and roles.",
    readOnly: true,
    inputSchema: object({}),
    build: () => ({ method: "GET", path: "/members" }),
  },
  {
    name: "list_companies",
    title: "List companies",
    description: "List customer companies, optionally filtered by name.",
    readOnly: true,
    inputSchema: object({ q: string("Search text.") }),
    build: (args) => ({ method: "GET", path: `/companies${query({ q: args.q })}` }),
  },
  {
    name: "create_company",
    title: "Create company",
    description: "Create a customer company.",
    readOnly: false,
    inputSchema: object(
      {
        name: string("Company name."),
        external_id: string("Your system's company id."),
        domain: string("Company domain."),
        traits: { type: "object", description: "Free-form attributes." },
      },
      ["name"],
    ),
    build: (args) => ({
      method: "POST",
      path: "/companies",
      body: compact({
        name: args.name,
        external_id: args.external_id,
        domain: args.domain,
        traits: args.traits,
      }),
    }),
  },
  {
    name: "list_conversations",
    title: "List conversations",
    description:
      "List support conversations. Defaults to the queue; use inbox_state=all to widen.",
    readOnly: true,
    inputSchema: object({
      inbox_state: enumeration(
        ["queue", "open", "all", "snoozed", "resolved", "spam", "archived"],
        "Inbox view.",
      ),
      assignee: string("Member id, `me` or `unassigned`."),
      updated_since: string("ISO 8601 timestamp."),
      q: string("Free-text search."),
      sort: enumeration(["newest", "oldest", "updated"], "Conversation sort."),
      limit,
      cursor,
    }),
    build: (args) => ({
      method: "GET",
      path: `/conversations${query({
        inbox_state: args.inbox_state,
        assignee: args.assignee,
        updated_since: args.updated_since,
        q: args.q,
        sort: args.sort,
        limit: args.limit,
        cursor: args.cursor,
      })}`,
    }),
  },
  {
    name: "get_conversation",
    title: "Get conversation",
    description: "Read one conversation.",
    readOnly: true,
    inputSchema: object({ conversation_id: uuid("Conversation UUID.") }, ["conversation_id"]),
    build: (args) => ({
      method: "GET",
      path: `/conversations/${segment(text(args, "conversation_id"))}`,
    }),
  },
  {
    name: "list_messages",
    title: "Read timeline",
    description: "Read a conversation timeline, including internal notes.",
    readOnly: true,
    inputSchema: object(
      {
        conversation_id: uuid("Conversation UUID."),
        sort: enumeration(["oldest", "newest"], "Message sort."),
        limit,
        cursor,
      },
      ["conversation_id"],
    ),
    build: (args) => ({
      method: "GET",
      path: `/conversations/${segment(text(args, "conversation_id"))}/messages${query({
        sort: args.sort,
        limit: args.limit,
        cursor: args.cursor,
      })}`,
    }),
  },
  {
    name: "reply_to_conversation",
    title: "Reply to customer",
    description:
      "Send a customer-visible reply. This queues email delivery, so use it only when a human asked for the send.",
    readOnly: false,
    inputSchema: object(
      {
        conversation_id: uuid("Conversation UUID."),
        body: string("Reply text."),
        ...idempotency(),
      },
      ["conversation_id", "body"],
    ),
    build: (args) => ({
      method: "POST",
      path: `/conversations/${segment(text(args, "conversation_id"))}/messages`,
      headers: idempotencyHeaders(args),
      body: { body: args.body },
    }),
  },
  {
    name: "add_conversation_note",
    title: "Add internal note",
    description: "Add a team-only note. Never sent to the customer.",
    readOnly: false,
    inputSchema: object(
      {
        conversation_id: uuid("Conversation UUID."),
        body: string("Note text."),
        ...idempotency(),
      },
      ["conversation_id", "body"],
    ),
    build: (args) => ({
      method: "POST",
      path: `/conversations/${segment(text(args, "conversation_id"))}/notes`,
      headers: idempotencyHeaders(args),
      body: { body: args.body },
    }),
  },
  {
    name: "update_conversation",
    title: "Update conversation",
    description: "Change a conversation's status or assignee.",
    readOnly: false,
    inputSchema: object(
      {
        conversation_id: uuid("Conversation UUID."),
        status: enumeration(["open", "resolved", "spam", "archived"], "New status."),
        assignee_id: { type: ["string", "null"], format: "uuid", description: "Member id or null." },
      },
      ["conversation_id"],
    ),
    build: (args) => ({
      method: "PATCH",
      path: `/conversations/${segment(text(args, "conversation_id"))}`,
      body: compact({ status: args.status, assignee_id: args.assignee_id }),
    }),
  },
];

const BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

export function findMcpTool(name: string): McpTool | null {
  return BY_NAME.get(name) ?? null;
}

/** The public `tools/list` shape: never includes the builder function. */
export function mcpToolList() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
      idempotentHint: tool.name === "update_request" || tool.name === "update_conversation",
    },
  }));
}
