import { API_ROUTE_DEFINITIONS } from "./routes";

/**
 * OpenAPI 3.1 description of `/api/v1`.
 *
 * Served from `/api/v1/openapi.json`. Operation details (parameters, schemas,
 * examples) live below so they stay reviewable, but the set of served paths and
 * operation ids is built from `API_ROUTE_DEFINITIONS`. A route that is not in
 * the manifest is not advertised, and a manifest entry with no operation spec
 * fails loudly instead of silently disappearing from the document.
 *
 * Public paths are relative to the server origin because a deployment can be
 * reached through several hosts.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ref("Error") } },
  };
}

function jsonBody(
  schema: string,
  example?: { summary: string; value: Record<string, unknown> },
) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: ref(schema),
        ...(example ? { examples: { workflow: example } } : {}),
      },
    },
  };
}

function dataResponse(schema: string) {
  return {
    description: "OK",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data"],
          properties: { data: ref(schema) },
        },
      },
    },
  };
}

function listResponse(schema: string) {
  return {
    description: "OK",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data", "pagination"],
          properties: {
            data: { type: "array", items: ref(schema) },
            pagination: ref("Pagination"),
          },
        },
      },
    },
  };
}

function created(schema: string) {
  return {
    description: "Created",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data"],
          properties: { data: ref(schema) },
        },
      },
    },
  };
}

const commonErrors = {
  "400": errorResponse("The request is malformed or a filter value is invalid."),
  "401": errorResponse("Missing or invalid bearer token."),
  "403": errorResponse("The token lacks the required scope."),
  "404": errorResponse("The resource does not exist in this workspace."),
  "429": errorResponse("Rate limit exceeded; honor `Retry-After`."),
};

const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Retry-safe key, 8–255 characters. The first response is stored for API_IDEMPOTENCY_TTL_HOURS (24 by default); repeating the same method, path and body replays it. Reusing the key for a different payload returns 422.",
  schema: { type: "string", minLength: 8, maxLength: 255 },
};

const parameters = {
  boardId: {
    name: "board_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  tagId: {
    name: "tag_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  fieldId: {
    name: "field_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  customField: {
    name: "custom_field",
    in: "query",
    description:
      "Repeatable `key:value` filter over a product's custom fields, for example `custom_field=plan:enterprise`. Every pair must match; at most five are accepted. Sort the matching requests with `sort=custom_field_asc:<key>` or `sort=custom_field_desc:<key>`.",
    schema: { type: "array", items: { type: "string" } },
  },
  requestId: {
    name: "request_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  releaseId: {
    name: "release_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  companyId: {
    name: "company_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  conversationId: {
    name: "conversation_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  limit: {
    name: "limit",
    in: "query",
    description: "Page size, 1–100.",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  cursor: {
    name: "cursor",
    in: "query",
    description: "Opaque cursor from `pagination.next_cursor`.",
    schema: { type: "string" },
  },
  status: {
    name: "status",
    in: "query",
    schema: {
      type: "string",
      enum: ["open", "under_review", "planned", "in_progress", "shipped", "closed"],
    },
  },
  board: {
    name: "board",
    in: "query",
    description: "Board id or slug.",
    schema: { type: "string" },
  },
  tag: {
    name: "tag",
    in: "query",
    description: "Tag id or name.",
    schema: { type: "string" },
  },
  author: {
    name: "author",
    in: "query",
    description: "Customer id, external id or email.",
    schema: { type: "string" },
  },
  updatedSince: {
    name: "updated_since",
    in: "query",
    description: "ISO 8601 timestamp; only rows updated at or after it.",
    schema: { type: "string", format: "date-time" },
  },
  q: {
    name: "q",
    in: "query",
    description: "Free-text search.",
    schema: { type: "string", maxLength: 200 },
  },
  sort: {
    name: "sort",
    in: "query",
    description:
      "Sort order; the cursor is bound to it. Requests accept `newest`, `oldest`, `updated`, `votes`, or a custom-field sort: `custom_field_asc:<key>` / `custom_field_desc:<key>`. Missing custom values sort last in both directions. The key must resolve to one storage type across the workspace.",
    schema: { type: "string" },
  },
  inboxState: {
    name: "inbox_state",
    in: "query",
    schema: {
      type: "string",
      enum: ["queue", "open", "all", "snoozed", "resolved", "spam", "archived"],
      default: "queue",
    },
  },
  assignee: {
    name: "assignee",
    in: "query",
    description: "A member user id, `me` or `unassigned`.",
    schema: { type: "string" },
  },
};

const paginationSchema = {
  type: "object",
  required: ["limit", "has_more", "next_cursor"],
  properties: {
    limit: { type: "integer" },
    has_more: { type: "boolean" },
    next_cursor: { type: ["string", "null"] },
  },
};

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Herald API",
    version: "1.0.0",
    summary:
      "Workspace-scoped REST API for boards, requests, comments, votes, tags, changelog, members, companies and conversations.",
    description:
      "Version 1. Responses carry `x-api-version: 1`; the compatibility and deprecation policy is documented in `docs/api-versioning.md`. Rate limits are per token and set by the workspace plan. Authenticate with a workspace API token as `Authorization: Bearer <token>`. The token's workspace is the only tenant the API can see. API-created changelog entries are drafts; internal notes are team-only. Send `Idempotency-Key` on request creation, comments and conversation replies/notes for safe retries.",
  },
  servers: [{ url: "/api/v1", description: "This deployment" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Boards" },
    { name: "Requests" },
    { name: "Tags" },
    { name: "Custom fields" },
    { name: "Changelog" },
    { name: "Members" },
    { name: "Companies" },
    { name: "Conversations" },
    { name: "Events" },
  ],
  paths: {
    "/": {
      get: {
        tags: ["Boards"],
        operationId: "getApiRoot",
        summary: "Describe this API and its workspace",
        responses: {
          "200": dataResponse("ApiRoot"),
          "401": commonErrors["401"],
          "429": commonErrors["429"],
        },
      },
    },
    "/boards": {
      get: {
        tags: ["Boards"],
        operationId: "listBoards",
        summary: "List boards in the workspace",
        parameters: [
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["position", "name", "newest"] },
          },
          {
            name: "include_archived",
            in: "query",
            schema: { type: "boolean", default: false },
          },
        ],
        responses: {
          "200": listResponse("Board"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "429": commonErrors["429"],
        },
      },
      post: {
        tags: ["Boards"],
        operationId: "createBoard",
        summary: "Create a board",
        requestBody: jsonBody("BoardCreate"),
        responses: {
          "201": created("Board"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("A board with that slug already exists in the product."),
        },
      },
    },
    "/boards/{board_id}": {
      parameters: [parameters.boardId],
      get: {
        tags: ["Boards"],
        operationId: "getBoard",
        summary: "Read one board",
        responses: {
          "200": dataResponse("Board"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      patch: {
        tags: ["Boards"],
        operationId: "updateBoard",
        summary: "Update or archive a board",
        requestBody: jsonBody("BoardUpdate"),
        responses: {
          "200": dataResponse("Board"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("A board with that slug already exists in the product."),
        },
      },
    },
    "/tags": {
      get: {
        tags: ["Tags"],
        operationId: "listTags",
        summary: "List board tags",
        parameters: [
          {
            name: "board",
            in: "query",
            description: "Board id or slug.",
            schema: { type: "string" },
          },
          {
            name: "product",
            in: "query",
            description: "Product id or slug.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": listResponse("Tag"),
          "401": commonErrors["401"],
        },
      },
      post: {
        tags: ["Tags"],
        operationId: "createTag",
        summary: "Create a tag on a board",
        requestBody: jsonBody("TagCreate"),
        responses: {
          "201": created("Tag"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("That board already has a tag with this name."),
        },
      },
    },
    "/custom-fields": {
      get: {
        tags: ["Custom fields"],
        operationId: "listCustomFields",
        summary: "List custom field definitions",
        parameters: [
          {
            name: "product",
            in: "query",
            description: "Product id or slug; omit for every product in the workspace.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": listResponse("CustomField"),
          "401": commonErrors["401"],
        },
      },
      post: {
        tags: ["Custom fields"],
        operationId: "createCustomField",
        summary: "Create a typed field on a product",
        requestBody: jsonBody("CustomFieldCreate", {
          summary: "Ask every request for a plan and an account value",
          value: {
            product_id: "c9f0f895-fb98-4c49-8f27-3a4d5e6f7081",
            key: "plan",
            label: "Plan",
            type: "select",
            options: ["Free", "Indie", "Professional"],
            required: true,
          },
        }),
        responses: {
          "201": created("CustomField"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("This product already has a field with that key."),
        },
      },
    },
    "/custom-fields/{field_id}": {
      parameters: [parameters.fieldId],
      get: {
        tags: ["Custom fields"],
        operationId: "getCustomField",
        summary: "Read one custom field",
        responses: {
          "200": dataResponse("CustomField"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      patch: {
        tags: ["Custom fields"],
        operationId: "updateCustomField",
        summary: "Update or archive a custom field",
        description:
          "The key and type are immutable once created; archive a field to remove it from the submit form while keeping stored values readable.",
        requestBody: jsonBody("CustomFieldUpdate"),
        responses: {
          "200": dataResponse("CustomField"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
      delete: {
        tags: ["Custom fields"],
        operationId: "deleteCustomField",
        summary: "Delete a custom field and its values",
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: { id: { type: "string" }, deleted: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/tags/{tag_id}": {
      parameters: [parameters.tagId],
      delete: {
        tags: ["Tags"],
        operationId: "deleteTag",
        summary: "Delete a tag",
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: { id: { type: "string" }, deleted: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/requests": {
      get: {
        tags: ["Requests"],
        operationId: "listRequests",
        summary: "List feedback requests",
        description:
          "Archived, hidden and merged duplicates are excluded by default; `include_archived` and `include_merged` opt in. Hidden requests are always excluded from votes.",
        parameters: [
          parameters.status,
          parameters.board,
          parameters.tag,
          parameters.author,
          parameters.customField,
          parameters.updatedSince,
          parameters.q,
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: ["newest", "oldest", "updated", "votes"],
              default: "newest",
            },
          },
          {
            name: "include_archived",
            in: "query",
            schema: { type: "boolean", default: false },
          },
          {
            name: "include_merged",
            in: "query",
            schema: { type: "boolean", default: false },
          },
          parameters.limit,
          parameters.cursor,
        ],
        responses: {
          "200": listResponse("Request"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "429": commonErrors["429"],
        },
      },
      post: {
        tags: ["Requests"],
        operationId: "createRequest",
        summary: "Create a request",
        description:
          "Without `customer` the request is authored by the token's creator. With `customer`, the person is resolved by `external_id` (preferred), email or id, and the board's approval policy applies: a moderated board returns `visibility: awaiting_review`.",
        parameters: [idempotencyHeader],
        requestBody: jsonBody("RequestCreate", {
          summary: "Submit feedback on behalf of a customer",
          value: {
            board_id: "8f14e45f-ceea-4a67-9c2e-2b3a4d5e6f70",
            title: "Export reports as CSV",
            body: "We need a CSV export for the monthly finance review.",
            category: "feature_request",
            customer: { email: "ada@example.com", name: "Ada Lovelace" },
          },
        }),
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: ref("Request"),
                    visibility: {
                      type: "string",
                      enum: ["published", "awaiting_review"],
                    },
                  },
                },
              },
            },
          },
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("An idempotent request is already in progress."),
          "422": errorResponse("The idempotency key was reused for a different request."),
        },
      },
    },
    "/requests/{request_id}": {
      parameters: [parameters.requestId],
      get: {
        tags: ["Requests"],
        operationId: "getRequest",
        summary: "Read one request",
        responses: {
          "200": dataResponse("Request"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      patch: {
        tags: ["Requests"],
        operationId: "updateRequest",
        summary: "Update a request",
        description:
          "A status change uses the same notification pipeline as the dashboard.",
        requestBody: jsonBody("RequestUpdate"),
        responses: {
          "200": dataResponse("Request"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/requests/{request_id}/brief": {
      parameters: [parameters.requestId],
      get: {
        tags: ["Requests"],
        operationId: "getRequestBrief",
        summary: "Read a request brief as Markdown",
        description:
          "Deterministic Markdown an agent or a person can paste into a ticket or PRD: problem, evidence with sources and dates, demand, current status and open questions. Internal notes and author emails are never included.",
        responses: {
          "200": dataResponse("RequestBrief"),
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/requests/{request_id}/comments": {
      parameters: [parameters.requestId],
      get: {
        tags: ["Requests"],
        operationId: "listComments",
        summary: "List comments and internal notes",
        parameters: [
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["oldest", "newest"], default: "oldest" },
          },
          parameters.limit,
          parameters.cursor,
        ],
        responses: {
          "200": listResponse("Comment"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      post: {
        tags: ["Requests"],
        operationId: "createComment",
        summary: "Reply to a request",
        description:
          "A public comment queues follower notifications. `internal: true` stores a team note that no customer-facing surface returns.",
        parameters: [idempotencyHeader],
        requestBody: jsonBody("CommentCreate", {
          summary: "Reply publicly to a request",
          value: { body: "This is now planned for the next release." },
        }),
        responses: {
          "201": created("Comment"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "422": errorResponse("The idempotency key was reused for a different request."),
        },
      },
    },
    "/requests/{request_id}/votes": {
      parameters: [parameters.requestId],
      post: {
        tags: ["Requests"],
        operationId: "voteOnRequest",
        summary: "Cast or withdraw a customer vote",
        requestBody: jsonBody("VoteCreate"),
        responses: {
          "200": dataResponse("VoteResult"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
      delete: {
        tags: ["Requests"],
        operationId: "removeVote",
        summary: "Withdraw a customer vote",
        parameters: [
          {
            name: "customer_id",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          { name: "external_id", in: "query", schema: { type: "string" } },
          { name: "email", in: "query", schema: { type: "string", format: "email" } },
        ],
        responses: {
          "200": dataResponse("VoteResult"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/changelogs": {
      get: {
        tags: ["Changelog"],
        operationId: "listChangelog",
        summary: "List changelog entries",
        parameters: [
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["draft", "scheduled", "published", "archived"],
            },
          },
          parameters.tag,
          parameters.updatedSince,
          parameters.q,
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["newest", "oldest", "updated"] },
          },
          parameters.limit,
          parameters.cursor,
        ],
        responses: {
          "200": listResponse("Changelog"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
        },
      },
      post: {
        tags: ["Changelog"],
        operationId: "createChangelogDraft",
        summary: "Create a changelog draft",
        description:
          "Always a draft. There is no status or publication field; publishing stays an explicit dashboard action.",
        parameters: [idempotencyHeader],
        requestBody: jsonBody("ChangelogCreate", {
          summary: "Draft a changelog entry",
          value: {
            product_id: "c9f0f895-fb98-4c49-8f27-3a4d5e6f7081",
            title: "CSV exports are here",
            slug: "csv-exports",
            summary: "Download any report as CSV from the reports page.",
            body: "Open Reports, choose a date range, and select Export CSV.",
            category: "feature",
            channels: { publicChangelog: true, subscriberEmail: true },
          },
        }),
        responses: {
          "201": created("Changelog"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("The slug is already used in this product."),
        },
      },
    },
    "/changelogs/{release_id}": {
      parameters: [parameters.releaseId],
      get: {
        tags: ["Changelog"],
        operationId: "getChangelog",
        summary: "Read one changelog entry",
        responses: {
          "200": dataResponse("Changelog"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      patch: {
        tags: ["Changelog"],
        operationId: "updateChangelogDraft",
        summary: "Update a changelog draft",
        description: "Only draft rows can change; published, scheduled and archived rows return 409.",
        requestBody: jsonBody("ChangelogUpdate"),
        responses: {
          "200": dataResponse("Changelog"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "409": errorResponse("Only drafts can be updated through the API."),
        },
      },
    },
    "/members": {
      get: {
        tags: ["Members"],
        operationId: "listMembers",
        summary: "List workspace members",
        responses: {
          "200": listResponse("Member"),
          "401": commonErrors["401"],
        },
      },
    },
    "/companies": {
      get: {
        tags: ["Companies"],
        operationId: "listCompanies",
        summary: "List customer companies",
        parameters: [parameters.q],
        responses: {
          "200": listResponse("Company"),
          "401": commonErrors["401"],
        },
      },
      post: {
        tags: ["Companies"],
        operationId: "createCompany",
        summary: "Create a customer company",
        requestBody: jsonBody("CompanyCreate"),
        responses: {
          "201": created("Company"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
        },
      },
    },
    "/companies/{company_id}": {
      parameters: [parameters.companyId],
      get: {
        tags: ["Companies"],
        operationId: "getCompany",
        summary: "Read a company and its customers",
        responses: {
          "200": dataResponse("CompanyDetail"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      patch: {
        tags: ["Companies"],
        operationId: "updateCompany",
        summary: "Update a company",
        requestBody: jsonBody("CompanyUpdate"),
        responses: {
          "200": dataResponse("CompanyDetail"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/companies/{company_id}/customers": {
      parameters: [parameters.companyId],
      post: {
        tags: ["Companies"],
        operationId: "addCompanyCustomer",
        summary: "Attach a customer to a company",
        requestBody: jsonBody("CompanyCustomerCreate", {
          summary: "Attach a customer to a company",
          value: { customer: { email: "ada@example.com" }, role: "admin" },
        }),
        responses: {
          "201": dataResponse("CompanyDetail"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/conversations": {
      get: {
        tags: ["Conversations"],
        operationId: "listConversations",
        summary: "List support conversations",
        parameters: [
          parameters.inboxState,
          parameters.assignee,
          parameters.updatedSince,
          parameters.q,
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["newest", "oldest", "updated"] },
          },
          parameters.limit,
          parameters.cursor,
        ],
        responses: {
          "200": listResponse("Conversation"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
        },
      },
    },
    "/conversations/{conversation_id}": {
      parameters: [parameters.conversationId],
      get: {
        tags: ["Conversations"],
        operationId: "getConversation",
        summary: "Read one conversation",
        responses: {
          "200": dataResponse("Conversation"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      patch: {
        tags: ["Conversations"],
        operationId: "updateConversation",
        summary: "Change status or assignee",
        requestBody: jsonBody("ConversationUpdate"),
        responses: {
          "200": dataResponse("Conversation"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
        },
      },
    },
    "/conversations/{conversation_id}/messages": {
      parameters: [parameters.conversationId],
      get: {
        tags: ["Conversations"],
        operationId: "listMessages",
        summary: "Read the timeline",
        description: "Includes internal notes; this endpoint is team-facing.",
        parameters: [
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["oldest", "newest"], default: "oldest" },
          },
          parameters.limit,
          parameters.cursor,
        ],
        responses: {
          "200": listResponse("Message"),
          "401": commonErrors["401"],
          "404": commonErrors["404"],
        },
      },
      post: {
        tags: ["Conversations"],
        operationId: "replyToConversation",
        summary: "Send a reply to the customer",
        description:
          "A reply opens a queued thread and queues the customer email in the same transaction as the message.",
        parameters: [idempotencyHeader],
        requestBody: jsonBody("MessageCreate", {
          summary: "Reply to a support conversation",
          value: { body: "I've refreshed the export for you; it should arrive in a minute." },
        }),
        responses: {
          "201": dataResponse("MessageReceipt"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "422": errorResponse("The idempotency key was reused for a different request."),
        },
      },
    },
    "/conversations/{conversation_id}/notes": {
      parameters: [parameters.conversationId],
      post: {
        tags: ["Conversations"],
        operationId: "addConversationNote",
        summary: "Add an internal note",
        description: "Never sent to the customer and never counted as a reply.",
        parameters: [idempotencyHeader],
        requestBody: jsonBody("MessageCreate", {
          summary: "Add an internal note",
          value: { body: "Customer is on the enterprise plan; prioritize this.", internal: true },
        }),
        responses: {
          "201": dataResponse("MessageReceipt"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "422": errorResponse("The idempotency key was reused for a different request."),
        },
      },
    },
    "/events": {
      post: {
        tags: ["Events"],
        operationId: "trackCustomerEvent",
        summary: "Record a customer product event",
        description:
          "Resolves the customer by `id`, `external_id` or `email` inside the token's workspace and stores the event for analytics and outbound targeting. `event_id` is your own dedupe key: replaying it returns the stored event with `duplicate: true`. Only the first insert emits `customer.event`.",
        parameters: [idempotencyHeader],
        requestBody: jsonBody("EventCreate", {
          summary: "Record an export against a customer",
          value: {
            product_id: "c9f0f895-fb98-4c49-8f27-3a4d5e6f7081",
            name: "report.exported",
            customer: { external_id: "user_123", email: "ada@example.com" },
            event_id: "evt_01HZX5R8K4",
            properties: { format: "csv", rows: 1200, scheduled: false },
          },
        }),
        responses: {
          "201": created("Event"),
          "200": dataResponse("Event"),
          "400": commonErrors["400"],
          "401": commonErrors["401"],
          "403": commonErrors["403"],
          "404": commonErrors["404"],
          "422": errorResponse("The idempotency key was reused for a different request."),
          "429": commonErrors["429"],
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Herald API token",
        description:
          "A workspace API token, shown once when created. Store it server-side; it is hashed at rest and cannot be recovered. Scopes: `read` (all reads), `write` (all mutations), `feedback:read`, `support:read` (resource-only reads) and `admin` (every current and future scope).",
      },
    },
    parameters: {
      IdempotencyKey: idempotencyHeader,
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "request_id"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              request_id: { type: "string" },
              details: {},
            },
          },
        },
      },
      Pagination: paginationSchema,
      EventCreate: {
        type: "object",
        required: ["product_id", "name", "customer"],
        properties: {
          product_id: { type: "string", format: "uuid" },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$",
            description:
              "Stable event name such as `report.exported` or `trial_started`.",
          },
          customer: ref("CustomerRef"),
          event_id: {
            type: "string",
            maxLength: 200,
            description:
              "Your dedupe id, unique per product. Reusing it returns the original event.",
          },
          occurred_at: {
            type: "string",
            format: "date-time",
            description:
              "When the event happened; defaults to now. Must be within the past 90 days and not in the future.",
          },
          properties: {
            type: "object",
            maxProperties: 50,
            additionalProperties: { type: ["string", "number", "boolean", "null"] },
            description: "Flat values under 4 KB; nested objects are rejected.",
          },
        },
      },
      Event: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          customer_id: { type: "string", format: "uuid" },
          external_id: { type: ["string", "null"] },
          occurred_at: { type: "string", format: "date-time" },
          received_at: { type: "string", format: "date-time" },
          duplicate: {
            type: "boolean",
            description: "True when the event id was already recorded.",
          },
        },
      },
      ApiRoot: {
        type: "object",
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          workspace: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              slug: { type: "string" },
            },
          },
          docs: { type: "string" },
        },
      },
      Board: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          slug: { type: "string" },
          description: { type: ["string", "null"] },
          icon: { type: ["string", "null"] },
          color: { type: ["string", "null"] },
          visibility: { type: "string", enum: ["public", "private"] },
          guest_posting: { type: "boolean" },
          moderation: ref("Moderation"),
          position: { type: "integer" },
          archived_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          product: ref("Product"),
          request_count: { type: "integer" },
        },
      },
      Moderation: {
        type: "object",
        required: ["requireApproval", "comments", "blockSensitiveInfo"],
        properties: {
          requireApproval: { type: "string", enum: ["none", "first_time", "all"] },
          comments: { type: "string", enum: ["open", "moderated", "closed"] },
          blockSensitiveInfo: { type: "boolean" },
        },
      },
      BoardCreate: {
        type: "object",
        required: ["product_id", "name"],
        properties: {
          product_id: { type: "string", format: "uuid" },
          name: { type: "string", maxLength: 80 },
          slug: { type: "string", maxLength: 80 },
          description: { type: ["string", "null"], maxLength: 500 },
          visibility: { type: "string", enum: ["public", "private"] },
          guest_posting: { type: "boolean" },
          settings: {
            type: "object",
            properties: { moderation: ref("Moderation") },
          },
          position: { type: "integer", minimum: 0 },
        },
      },
      BoardUpdate: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 80 },
          slug: { type: "string", maxLength: 80 },
          description: { type: ["string", "null"], maxLength: 500 },
          visibility: { type: "string", enum: ["public", "private"] },
          guest_posting: { type: "boolean" },
          settings: {
            type: "object",
            properties: { moderation: ref("Moderation") },
          },
          position: { type: "integer", minimum: 0 },
          archived: { type: "boolean" },
        },
      },
      CustomField: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          key: { type: "string" },
          label: { type: "string" },
          description: { type: ["string", "null"] },
          type: { type: "string", enum: ["text", "number", "select", "date"] },
          options: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
          position: { type: "integer" },
          archived: { type: "boolean" },
          archived_at: { type: ["string", "null"], format: "date-time" },
          product: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              slug: { type: "string" },
            },
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      CustomFieldCreate: {
        type: "object",
        required: ["product_id", "label", "type"],
        properties: {
          product_id: { type: "string", format: "uuid" },
          key: {
            type: "string",
            description:
              "Stable snake_case name. Derived from the label when omitted and immutable afterwards.",
          },
          label: { type: "string", maxLength: 80 },
          description: { type: ["string", "null"], maxLength: 300 },
          type: { type: "string", enum: ["text", "number", "select", "date"] },
          options: {
            type: "array",
            items: { type: "string", maxLength: 80 },
            description: "Required for select fields.",
          },
          required: { type: "boolean", default: false },
          position: { type: "integer", minimum: 0 },
        },
      },
      CustomFieldUpdate: {
        type: "object",
        properties: {
          label: { type: "string", maxLength: 80 },
          description: { type: ["string", "null"], maxLength: 300 },
          options: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
          archived: { type: "boolean" },
          position: { type: "integer", minimum: 0 },
        },
      },
      Tag: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          color: { type: ["string", "null"] },
          position: { type: "integer" },
          board_id: { type: "string", format: "uuid" },
          product_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      TagCreate: {
        type: "object",
        required: ["board_id", "name"],
        properties: {
          board_id: { type: "string", format: "uuid" },
          name: { type: "string", maxLength: 40 },
          color: { type: ["string", "null"], pattern: "^#[0-9a-fA-F]{6}$" },
        },
      },
      Product: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          name: { type: "string" },
        },
      },
      CustomerRef: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          external_id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
        },
      },
      RequestBrief: {
        type: "object",
        properties: {
          request_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          markdown: {
            type: "string",
            description: "The brief as Markdown.",
          },
        },
      },
      Request: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          body: { type: "string" },
          status: { type: "string" },
          category: { type: "string" },
          source: { type: "string" },
          board: {
            type: ["object", "null"],
            properties: {
              id: { type: "string", format: "uuid" },
              slug: { type: "string" },
              name: { type: "string" },
            },
          },
          product: ref("Product"),
          author: {
            type: ["object", "null"],
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
              external_id: { type: ["string", "null"] },
            },
          },
          created_by: { type: ["string", "null"] },
          author_label: { type: ["string", "null"] },
          author_email: { type: ["string", "null"] },
          author_company: { type: ["string", "null"] },
          vote_count: { type: "integer" },
          comment_count: { type: "integer" },
          custom_fields: {
            type: "object",
            additionalProperties: { type: ["string", "number"] },
            description:
              "Stored values keyed by the field's stable key. A missing key means the field is unset.",
          },
          signals: ref("Prioritisation"),
          tags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                color: { type: ["string", "null"] },
              },
            },
          },
          archived: { type: "boolean" },
          hidden: { type: "boolean" },
          merged_into_id: { type: ["string", "null"], format: "uuid" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      RequestCreate: {
        type: "object",
        required: ["board_id", "title", "body"],
        properties: {
          board_id: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 3, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 20000 },
          category: {
            type: "string",
            enum: ["feature_request", "bug", "improvement", "question"],
          },
          status: {
            type: "string",
            enum: ["open", "under_review", "planned", "in_progress", "shipped", "closed"],
          },
          tag_ids: { type: "array", items: { type: "string", format: "uuid" } },
          custom_fields: {
            type: "object",
            additionalProperties: { type: ["string", "number", "null"] },
            description:
              "Values keyed by field key; validated against the product's definitions and their required flags.",
          },
          customer: ref("CustomerRef"),
        },
      },
      Prioritisation: {
        type: "object",
        description:
          "Every value is derived from stored rows; `null` means the input or revenue is unknown, never zero. `priority_score` is impact ÷ effort × demand, where demand is the requester weight with a floor of 1.",
        properties: {
          impact: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          business_value: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          effort: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          value_per_effort: { type: ["number", "null"] },
          requester_count: { type: "integer" },
          requester_weight: { type: "integer" },
          known_arr: { type: ["number", "null"] },
          known_open_deal_value: { type: ["number", "null"] },
          priority_score: { type: ["number", "null"] },
        },
      },
      RequestUpdate: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 3, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 20000 },
          category: {
            type: "string",
            enum: ["feature_request", "bug", "improvement", "question"],
          },
          status: {
            type: "string",
            enum: ["open", "under_review", "planned", "in_progress", "shipped", "closed"],
          },
          tag_ids: { type: "array", items: { type: "string", format: "uuid" } },
          hidden: { type: "boolean" },
          custom_fields: {
            type: "object",
            additionalProperties: { type: ["string", "number", "null"] },
            description: "Replaces the stored values; an omitted field is cleared.",
          },
          impact: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          business_value: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          effort: { type: ["integer", "null"], minimum: 1, maximum: 5 },
        },
      },
      Comment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          request_id: { type: "string", format: "uuid" },
          body: { type: "string" },
          internal: { type: "boolean" },
          author_type: { type: "string", enum: ["customer", "team"] },
          author: {
            type: "object",
            properties: {
              name: { type: "string" },
              customer_id: { type: ["string", "null"] },
              user_id: { type: ["string", "null"] },
            },
          },
          created_at: { type: "string", format: "date-time" },
        },
      },
      CommentCreate: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 10000 },
          internal: { type: "boolean", default: false },
        },
      },
      VoteCreate: {
        type: "object",
        required: ["customer"],
        properties: {
          customer: ref("CustomerRef"),
          voted: { type: "boolean", default: true },
        },
      },
      VoteResult: {
        type: "object",
        properties: {
          voted: { type: "boolean" },
          vote_count: { type: "integer" },
        },
      },
      Changelog: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          slug: { type: "string" },
          summary: { type: ["string", "null"] },
          body: { type: ["string", "null"] },
          status: { type: "string", enum: ["draft", "scheduled", "published", "archived"] },
          category: { type: "string" },
          version: { type: ["string", "null"] },
          youtube_url: { type: ["string", "null"] },
          published_at: { type: ["string", "null"], format: "date-time" },
          scheduled_for: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          product: ref("Product"),
          tags: { type: "array", items: { type: "string" } },
          authors: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" } },
            },
          },
          linked_request_ids: { type: "array", items: { type: "string", format: "uuid" } },
        },
      },
      ChangelogCreate: {
        type: "object",
        required: ["product_id", "title", "slug"],
        properties: {
          product_id: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 3, maxLength: 120 },
          slug: { type: "string" },
          summary: { type: "string", maxLength: 280 },
          body: { type: "string", maxLength: 200000 },
          category: { type: "string", enum: ["feature", "improvement", "fix"] },
          tags: { type: "array", items: { type: "string" } },
          authorIds: { type: "array", items: { type: "string" } },
          youtubeUrl: { type: ["string", "null"] },
          cover: { type: "object" },
          channels: {
            type: "object",
            properties: {
              publicChangelog: { type: "boolean" },
              inAppWidget: { type: "boolean" },
              subscriberEmail: { type: "boolean" },
            },
          },
          linkedFeedbackIds: { type: "array", items: { type: "string", format: "uuid" } },
          linkedCancellationReasonIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
        },
      },
      ChangelogUpdate: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 3, maxLength: 120 },
          slug: { type: "string" },
          summary: { type: "string", maxLength: 280 },
          body: { type: "string", maxLength: 200000 },
          category: { type: "string", enum: ["feature", "improvement", "fix"] },
          tags: { type: "array", items: { type: "string" } },
          authorIds: { type: "array", items: { type: "string" } },
          youtubeUrl: { type: ["string", "null"] },
          cover: { type: "object" },
          channels: {
            type: "object",
            properties: {
              publicChangelog: { type: "boolean" },
              inAppWidget: { type: "boolean" },
              subscriberEmail: { type: "boolean" },
            },
          },
          linkedFeedbackIds: { type: "array", items: { type: "string", format: "uuid" } },
          linkedCancellationReasonIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
        },
      },
      Member: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["owner", "admin", "editor"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Company: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          external_id: { type: ["string", "null"] },
          domain: { type: ["string", "null"] },
          traits: { type: "object" },
          customer_count: { type: "integer" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      CompanyDetail: {
        allOf: [
          ref("Company"),
          {
            type: "object",
            properties: {
              customers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: ["string", "null"] },
                    email: { type: ["string", "null"] },
                    role: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
        ],
      },
      CompanyCreate: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", maxLength: 200 },
          external_id: { type: ["string", "null"] },
          domain: { type: ["string", "null"] },
          traits: { type: "object" },
        },
      },
      CompanyUpdate: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 200 },
          external_id: { type: ["string", "null"] },
          domain: { type: ["string", "null"] },
          traits: { type: "object" },
        },
      },
      CompanyCustomerCreate: {
        type: "object",
        required: ["customer"],
        properties: {
          customer: ref("CustomerRef"),
          role: { type: ["string", "null"] },
        },
      },
      Conversation: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          subject: { type: "string" },
          status: {
            type: "string",
            enum: ["queue", "open", "snoozed", "resolved", "spam", "archived"],
          },
          product: ref("Product"),
          customer: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
            },
          },
          assignee: {
            type: ["object", "null"],
            properties: {
              id: { type: "string" },
              name: { type: ["string", "null"] },
            },
          },
          unread_for_team: { type: "integer" },
          last_message_preview: { type: "string" },
          last_message_at: { type: "string", format: "date-time" },
          snoozed_until: { type: ["string", "null"], format: "date-time" },
          resolved_at: { type: ["string", "null"], format: "date-time" },
          source_url: { type: ["string", "null"] },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      ConversationUpdate: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "resolved", "spam", "archived"] },
          assignee_id: { type: ["string", "null"], format: "uuid" },
        },
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          conversation_id: { type: "string", format: "uuid" },
          kind: { type: "string", enum: ["message", "note"] },
          author_type: { type: "string", enum: ["customer", "team", "juno", "system"] },
          author: { type: ["string", "null"] },
          body: { type: "string" },
          channel: { type: "string" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      MessageCreate: {
        type: "object",
        required: ["body"],
        properties: { body: { type: "string", minLength: 1, maxLength: 10000 } },
      },
      MessageReceipt: {
        type: "object",
        properties: {
          id: { type: ["string", "null"], format: "uuid" },
          conversation_id: { type: "string", format: "uuid" },
          kind: { type: "string", enum: ["message", "note"] },
          status: { type: "string" },
        },
      },
    },
  },
} as const;

type PathOperationSpecs = Record<
  string,
  Record<string, unknown> & { parameters?: readonly unknown[] }
>;

/**
 * Build the served `paths` object from the route manifest.
 *
 * Path-level parameters are preserved, but only operations declared in the
 * manifest are copied. This is what makes the router contract and the published
 * contract the same list rather than two lists that have to be kept in sync by
 * hand.
 */
export function buildOpenApiPaths(
  definitions: typeof API_ROUTE_DEFINITIONS,
  specs: PathOperationSpecs = openApiSpec.paths,
): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const definition of definitions) {
    const pathSpec = specs[definition.path];
    if (!pathSpec) {
      throw new Error(`OpenAPI path ${definition.path} has no operation spec.`);
    }

    const verb = definition.method.toLowerCase();
    const operation = pathSpec[verb];
    if (!operation || typeof operation !== "object") {
      throw new Error(
        `OpenAPI operation ${definition.method} ${definition.path} has no spec.`,
      );
    }

    const item = paths[definition.path] ?? {};
    if (pathSpec.parameters) item.parameters = pathSpec.parameters;
    item[verb] = { ...(operation as Record<string, unknown>), operationId: definition.operationId };
    paths[definition.path] = item;
  }

  return paths;
}

export const openApiDocument = {
  ...openApiSpec,
  paths: buildOpenApiPaths(API_ROUTE_DEFINITIONS),
} as const;

export type OpenApiDocument = typeof openApiDocument;
