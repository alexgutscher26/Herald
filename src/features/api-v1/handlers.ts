import { NextResponse } from "next/server";
import { z } from "zod";

import { slugify, validateSlug } from "@/lib/slug";
import { isUniqueViolation } from "@/lib/error-message";
import { releaseDraftCreateSchema, releaseDraftUpdateSchema } from "@/features/releases/draft-schema";
import {
  customFieldKeyFromLabel,
  isValidCustomFieldKey,
  normalizeCustomFieldOptions,
} from "@/features/feedback/custom-fields";

import { recordCustomerEvent } from "@/features/events/service";
import { loadRequestBrief } from "@/features/feedback/brief-service";

import type { ApiAuth } from "./auth";
import { actingUserId, requireScope } from "./auth";
import { decodeCursor, encodeCursor } from "./cursor";
import {
  parseBoardSort,
  parseChangelogFilters,
  parseConversationFilters,
  parseRequestFilters,
  requestSortKey,
} from "./filters";
import { ApiFailure, apiJson, apiNotFound, parseBody, readJsonBody } from "./http";
import {
  conversationCursorValue,
  createBoard,
  createChangelog,
  createComment,
  createCompany,
  createCustomFieldDefinition,
  createRequest,
  createTag,
  deleteCustomFieldDefinition,
  deleteTag,
  getBoard,
  getCustomFieldDefinition,
  getCompany,
  getConversation,
  getRelease,
  getRequest,
  listBoards,
  listComments,
  listCompanies,
  listConversations,
  listCustomFieldDefinitions,
  listMembers,
  listMessages,
  listReleases,
  listRequests,
  listTags,
  addCompanyCustomer,
  appendMessage,
  resolveProduct,
  releaseCursorValue,
  requestCursorValue,
  resolveRequestCustomSortType,
  setRequestVote,
  updateBoard,
  updateChangelog,
  updateCompany,
  updateConversation,
  updateCustomFieldDefinition,
  updateRequest,
} from "./service";
import {
  serializeBoard,
  serializeComment,
  serializeCompany,
  serializeCustomField,
  serializeConversation,
  serializeMember,
  serializeMessage,
  serializeRelease,
  serializeRequest,
  serializeTag,
} from "./serialize";

/**
 * One handler per endpoint.
 *
 * Handlers parse, validate and shape JSON; they call the service for every
 * query and write. A service "not found" becomes a uniform 404 so a guessed id
 * from another workspace cannot be distinguished from a missing one.
 */

const customerInput = z
  .object({
    id: z.uuid().optional(),
    external_id: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(320).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .refine((value) => value.id || value.external_id || value.email, {
    message: "Supply an id, external_id or email.",
  });

const eventPropertiesSchema = z.record(
  z.string().trim().min(1).max(64),
  z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
);

const eventCreateSchema = z.object({
  product_id: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/,
      "Use letters, digits, dot, colon, underscore or hyphen.",
    ),
  customer: customerInput,
  event_id: z.string().trim().min(1).max(200).optional(),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  properties: eventPropertiesSchema.default({}),
});

const moderationSchema = z.object({
  requireApproval: z.enum(["none", "first_time", "all"]),
  comments: z.enum(["open", "moderated", "closed"]),
  blockSensitiveInfo: z.boolean(),
});

const boardSettingsSchema = z.object({ moderation: moderationSchema });

const boardCreateSchema = z.object({
  product_id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  visibility: z.enum(["public", "private"]).default("public"),
  guest_posting: z.boolean().default(false),
  settings: boardSettingsSchema.optional(),
  position: z.number().int().min(0).max(10_000).default(0),
});

const boardUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  guest_posting: z.boolean().optional(),
  settings: boardSettingsSchema.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  archived: z.boolean().optional(),
});

const tagCreateSchema = z.object({
  board_id: z.uuid(),
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex colour such as #2563eb.")
    .nullable()
    .optional(),
});

const requestCreateSchema = z.object({
  board_id: z.uuid(),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20_000),
  category: z
    .enum(["feature_request", "bug", "improvement", "question"])
    .default("question"),
  status: z
    .enum(["open", "under_review", "planned", "in_progress", "shipped", "closed"])
    .optional(),
  tag_ids: z.array(z.uuid()).max(20).optional(),
  custom_fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .optional(),
  customer: customerInput.optional(),
});

const requestUpdateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  category: z.enum(["feature_request", "bug", "improvement", "question"]).optional(),
  status: z
    .enum(["open", "under_review", "planned", "in_progress", "shipped", "closed"])
    .optional(),
  tag_ids: z.array(z.uuid()).max(20).optional(),
  hidden: z.boolean().optional(),
  custom_fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .optional(),
  impact: z.number().int().min(1).max(5).nullable().optional(),
  business_value: z.number().int().min(1).max(5).nullable().optional(),
  effort: z.number().int().min(1).max(5).nullable().optional(),
});

const customFieldCreateSchema = z.object({
  product_id: z.uuid(),
  key: z.string().trim().max(40).optional(),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  type: z.enum(["text", "number", "select", "date"]),
  options: z.array(z.string()).max(40).optional(),
  required: z.boolean().default(false),
  position: z.number().int().min(0).max(10_000).optional(),
});

const customFieldUpdateSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  options: z.array(z.string()).max(40).optional(),
  required: z.boolean().optional(),
  archived: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

const commentCreateSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  internal: z.boolean().default(false),
});

const voteSchema = z.object({
  customer: customerInput,
  voted: z.boolean().default(true),
});

const changelogCreateSchema = releaseDraftCreateSchema.extend({
  product_id: z.uuid(),
});

const changelogUpdateSchema = releaseDraftUpdateSchema;

const companyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  external_id: z.string().trim().min(1).max(200).nullable().optional(),
  domain: z.string().trim().max(255).nullable().optional(),
  traits: z.record(z.string(), z.unknown()).optional(),
});

const companyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  external_id: z.string().trim().min(1).max(200).nullable().optional(),
  domain: z.string().trim().max(255).nullable().optional(),
  traits: z.record(z.string(), z.unknown()).optional(),
});

const companyCustomerSchema = z.object({
  customer: customerInput,
  role: z.string().trim().max(80).nullable().optional(),
});

const conversationUpdateSchema = z.object({
  status: z.enum(["open", "resolved", "spam", "archived"]).optional(),
  // Better Auth user ids are opaque strings, not uuids; the service verifies
  // that the id belongs to a member of this workspace.
  assignee_id: z.string().trim().min(1).max(120).nullable().optional(),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

function ok(auth: ApiAuth, data: unknown, status = 200): NextResponse {
  return apiJson({ data }, { status, requestId: auth.requestId });
}

function paginated<T>(
  auth: ApiAuth,
  items: T[],
  input: { limit: number; hasMore: boolean; nextCursor: string | null },
): NextResponse {
  return apiJson(
    {
      data: items,
      pagination: {
        limit: input.limit,
        has_more: input.hasMore,
        next_cursor: input.hasMore ? input.nextCursor : null,
      },
    },
    { requestId: auth.requestId },
  );
}

function requireJsonBody(bodyText: string): unknown {
  return readJsonBody(bodyText);
}

function parseBooleanParam(params: URLSearchParams, name: string): boolean {
  const raw = params.get(name);
  if (raw === null || raw === "") return false;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ApiFailure(400, "invalid_request", `\`${name}\` must be true or false.`);
}

type SubList = {
  sort: "oldest" | "newest";
  limit: number;
  cursor: { value: string; id: string } | null;
};

function parseSubList(params: URLSearchParams): SubList {
  const sort = params.get("sort") ?? "oldest";
  if (sort !== "oldest" && sort !== "newest") {
    throw new ApiFailure(400, "invalid_request", "`sort` must be oldest or newest.");
  }

  const rawLimit = params.get("limit") ?? "25";
  if (!/^\d{1,3}$/.test(rawLimit)) {
    throw new ApiFailure(400, "invalid_request", "`limit` must be between 1 and 100.");
  }
  const limit = Number.parseInt(rawLimit, 10);
  if (limit < 1 || limit > 100) {
    throw new ApiFailure(400, "invalid_request", "`limit` must be between 1 and 100.");
  }

  const rawCursor = params.get("cursor");
  if (rawCursor === null) return { sort, limit, cursor: null };

  const decoded = decodeCursor(rawCursor);
  if (!decoded) {
    throw new ApiFailure(400, "invalid_request", "`cursor` is not a valid cursor.");
  }
  if (decoded.sort !== sort) {
    throw new ApiFailure(
      400,
      "invalid_request",
      "`cursor` belongs to a different sort; restart without it.",
    );
  }
  return { sort, limit, cursor: { value: decoded.value, id: decoded.id } };
}

function parseDateCursor(sort: SubList["sort"], cursor: SubList["cursor"]) {
  if (!cursor) return { value: null, id: null };
  const value = new Date(cursor.value);
  if (Number.isNaN(value.getTime())) {
    throw new ApiFailure(400, "invalid_request", "`cursor` is not a valid cursor.");
  }
  return { value, id: cursor.id };
}

function methodNotAllowed(allowed: string[]): ApiFailure {
  return new ApiFailure(405, "invalid_request", "Method not allowed.", {
    headers: { allow: allowed.join(", ") },
  });
}

export async function handleRoot(auth: ApiAuth): Promise<NextResponse> {
  return ok(auth, {
    name: "Herald API",
    version: "1",
    workspace: { id: auth.workspaceId, slug: auth.workspaceSlug },
    docs: "/api/v1/openapi.json",
  });
}

// ---------------------------------------------------------------------------
// Boards and tags
// ---------------------------------------------------------------------------

export async function handleBoards(auth: ApiAuth, request: Request, method: string) {
  const params = new URL(request.url).searchParams;

  if (method === "GET") {
    requireScope(auth, "read");
    const sort = parseBoardSort(params);
    if (!sort.ok) throw new ApiFailure(400, "invalid_request", sort.error);

    const page = await listBoards({
      workspaceId: auth.workspaceId,
      sort: sort.value,
      includeArchived: parseBooleanParam(params, "include_archived"),
    });

    return paginated(auth, page.items.map(serializeBoard), {
      limit: page.items.length,
      hasMore: false,
      nextCursor: null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    return handleCreateBoard(auth, await request.text());
  }

  throw methodNotAllowed(["GET", "POST"]);
}

async function handleCreateBoard(auth: ApiAuth, bodyText: string): Promise<NextResponse> {
  const input = parseBody(boardCreateSchema, requireJsonBody(bodyText));
  const product = await resolveProduct(auth.workspaceId, input.product_id);
  if (!product) throw apiNotFound(auth.requestId, "Product");

  const rawSlug = input.slug && input.slug.length > 0 ? input.slug : slugify(input.name);
  const slug = validateSlug(rawSlug);
  if (!slug.ok) {
    throw new ApiFailure(400, "validation_failed", "Check the board fields.", {
      details: { slug: [slug.reason] },
    });
  }

  const created = await createBoard({
    workspaceId: auth.workspaceId,
    productId: product.id,
    name: input.name,
    slug: slug.slug,
    description: input.description ?? null,
    visibility: input.visibility,
    guestPosting: input.guest_posting,
    settings: input.settings ?? {
      moderation: {
        requireApproval: "none",
        comments: "open",
        blockSensitiveInfo: false,
      },
    },
    position: input.position,
  }).catch((error: unknown) => {
    if (isUniqueViolation(error)) {
      throw new ApiFailure(409, "conflict", "That board slug is already used in this product.");
    }
    throw error;
  });

  const board = await getBoard(auth.workspaceId, created);
  if (!board) throw new Error("Board was created but could not be read back.");
  return ok(auth, serializeBoard(board), 201);
}

export async function handleBoard(
  auth: ApiAuth,
  request: Request,
  method: string,
  boardId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const board = await getBoard(auth.workspaceId, boardId);
    if (!board) throw apiNotFound(auth.requestId, "Board");
    return ok(auth, serializeBoard(board));
  }

  if (method === "PATCH") {
    requireScope(auth, "write");
    const input = parseBody(boardUpdateSchema, requireJsonBody(await request.text()));
    const updated = await updateBoard(auth.workspaceId, boardId, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      ...(input.guest_posting === undefined ? {} : { guestPosting: input.guest_posting }),
      ...(input.settings === undefined ? {} : { settings: input.settings }),
      ...(input.position === undefined ? {} : { position: input.position }),
      ...(input.archived === undefined ? {} : { archived: input.archived }),
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) {
        throw new ApiFailure(409, "conflict", "That board slug is already used in this product.");
      }
      throw error;
    });

    if (!updated) throw apiNotFound(auth.requestId, "Board");
    const board = await getBoard(auth.workspaceId, boardId);
    if (!board) throw apiNotFound(auth.requestId, "Board");
    return ok(auth, serializeBoard(board));
  }

  throw methodNotAllowed(["GET", "PATCH"]);
}

export async function handleTags(auth: ApiAuth, request: Request, method: string) {
  if (method === "GET") {
    requireScope(auth, "read");
    const params = new URL(request.url).searchParams;
    const tags = await listTags({
      workspaceId: auth.workspaceId,
      board: params.get("board"),
      product: params.get("product"),
    });
    return paginated(auth, tags.map(serializeTag), {
      limit: tags.length,
      hasMore: false,
      nextCursor: null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    const input = parseBody(tagCreateSchema, requireJsonBody(await request.text()));
    const result = await createTag({
      workspaceId: auth.workspaceId,
      boardId: input.board_id,
      name: input.name,
      color: input.color ?? null,
    });
    if (!result.ok) {
      if (result.error === "Board not found.") {
        throw new ApiFailure(404, "not_found", result.error);
      }
      throw new ApiFailure(409, "conflict", result.error);
    }
    const tags = await listTags({
      workspaceId: auth.workspaceId,
      board: input.board_id,
      product: null,
    });
    const tag = tags.find((row) => row.id === result.id);
    return ok(auth, tag ? serializeTag(tag) : { id: result.id }, 201);
  }

  throw methodNotAllowed(["GET", "POST"]);
}

export async function handleTag(
  auth: ApiAuth,
  method: string,
  tagId: string,
): Promise<NextResponse> {
  if (method !== "DELETE") throw methodNotAllowed(["DELETE"]);
  requireScope(auth, "write");

  const deleted = await deleteTag(auth.workspaceId, tagId);
  if (!deleted) throw apiNotFound(auth.requestId, "Tag");
  return ok(auth, { id: tagId, deleted: true });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function handleRequests(auth: ApiAuth, request: Request, method: string) {
  if (method === "GET") {
    requireScope(auth, "read");
    const parsed = parseRequestFilters(new URL(request.url).searchParams);
    if (!parsed.ok) throw new ApiFailure(400, "invalid_request", parsed.error);

    let customSortType: "number" | "text" | undefined;
    if (parsed.value.customSort) {
      const resolved = await resolveRequestCustomSortType(
        auth.workspaceId,
        parsed.value.customSort.key,
      );
      if (resolved === null) {
        throw new ApiFailure(
          400,
          "invalid_request",
          `No custom field named \`${parsed.value.customSort.key}\` exists in this workspace.`,
        );
      }
      if (resolved === "ambiguous") {
        throw new ApiFailure(
          400,
          "invalid_request",
          `The custom field \`${parsed.value.customSort.key}\` has different storage types across products, so it cannot be sorted consistently.`,
        );
      }
      customSortType = resolved;
    }

    const page = await listRequests({
      workspaceId: auth.workspaceId,
      filters: parsed.value,
      customSortType,
    });
    const items = page.items.map((item) =>
      serializeRequest(item.row, item.tags, item),
    );
    const last = page.items[page.items.length - 1];

    return paginated(auth, items, {
      limit: parsed.value.limit,
      hasMore: page.hasMore,
      nextCursor: last
        ? encodeCursor({
            sort: requestSortKey(parsed.value.sort, parsed.value.customSort),
            value: requestCursorValue(last, parsed.value),
            id: last.row.id,
          })
        : null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    return handleCreateRequest(auth, await request.text());
  }

  throw methodNotAllowed(["GET", "POST"]);
}

async function handleCreateRequest(auth: ApiAuth, bodyText: string): Promise<NextResponse> {
  const input = parseBody(requestCreateSchema, requireJsonBody(bodyText));
  const result = await createRequest({
    workspaceId: auth.workspaceId,
    userId: actingUserId(auth),
    boardId: input.board_id,
    title: input.title,
    body: input.body,
    category: input.category,
    status: input.status,
    tagIds: input.tag_ids,
    customFields: input.custom_fields,
    customer: input.customer,
  });

  if (!result.ok) {
    throw new ApiFailure(
      result.status,
      result.status === 404 ? "not_found" : "validation_failed",
      result.error,
      { details: result.details },
    );
  }

  const created = await getRequest(auth.workspaceId, result.id);
  if (!created) throw new Error("Request was created but could not be read back.");

  return apiJson(
    {
      data: serializeRequest(created.row, created.tags, created),
      visibility: result.visibility,
    },
    { status: 201, requestId: auth.requestId },
  );
}

export async function handleEvents(
  auth: ApiAuth,
  request: Request,
  method: string,
) {
  if (method !== "POST") {
    throw new ApiFailure(405, "invalid_request", "Method not allowed.", {
      headers: { allow: "POST" },
    });
  }
  requireScope(auth, "write");

  const input = parseBody(eventCreateSchema, readJsonBody(await request.text()));
  if (Object.keys(input.properties).length > 50) {
    throw new ApiFailure(400, "validation_failed", "Check the request fields.", {
      details: { properties: ["Use at most 50 properties."] },
    });
  }

  const result = await recordCustomerEvent({
    workspaceId: auth.workspaceId,
    productId: input.product_id,
    name: input.name,
    customer: input.customer,
    eventId: input.event_id ?? null,
    properties: input.properties,
    occurredAt: input.occurred_at ? new Date(input.occurred_at) : undefined,
  });

  if (!result.ok) {
    throw new ApiFailure(
      result.status,
      result.status === 404 ? "not_found" : "validation_failed",
      result.error,
      { details: result.details },
    );
  }

  return apiJson(
    {
      data: {
        id: result.id,
        name: result.name,
        customer_id: result.customerId,
        external_id: result.customerExternalId,
        occurred_at: result.occurredAt,
        received_at: result.receivedAt,
        duplicate: result.duplicate,
      },
    },
    { status: result.duplicate ? 200 : 201, requestId: auth.requestId },
  );
}

export async function handleRequest(
  auth: ApiAuth,
  request: Request,
  method: string,
  requestId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const found = await getRequest(auth.workspaceId, requestId);
    if (!found) throw apiNotFound(auth.requestId, "Request");
    return ok(auth, serializeRequest(found.row, found.tags, found));
  }

  if (method === "PATCH") {
    requireScope(auth, "write");
    const input = parseBody(requestUpdateSchema, requireJsonBody(await request.text()));
    const result = await updateRequest({
      workspaceId: auth.workspaceId,
      userId: actingUserId(auth),
      requestId,
      title: input.title,
      body: input.body,
      category: input.category,
      status: input.status,
      tagIds: input.tag_ids,
      hidden: input.hidden,
      customFields: input.custom_fields,
      impact: input.impact,
      businessValue: input.business_value,
      effort: input.effort,
    });
    if (!result.ok) {
      throw new ApiFailure(
        result.status,
        result.status === 404 ? "not_found" : "invalid_request",
        result.error,
      );
    }
    const found = await getRequest(auth.workspaceId, requestId);
    if (!found) throw apiNotFound(auth.requestId, "Request");
    return ok(auth, serializeRequest(found.row, found.tags, found));
  }

  throw methodNotAllowed(["GET", "PATCH"]);
}

/**
 * A request brief is read-only by design. There is no write counterpart: the
 * brief is an artifact a human or agent pastes into a ticket, not a resource.
 */
export async function handleRequestBrief(
  auth: ApiAuth,
  method: string,
  requestId: string,
): Promise<NextResponse> {
  if (method !== "GET") throw methodNotAllowed(["GET"]);
  requireScope(auth, "read");

  const brief = await loadRequestBrief({
    workspaceId: auth.workspaceId,
    requestId,
  });
  if (!brief) throw apiNotFound(auth.requestId, "Request");

  return ok(auth, {
    request_id: brief.requestId,
    title: brief.title,
    markdown: brief.markdown,
  });
}

export async function handleComments(
  auth: ApiAuth,
  request: Request,
  method: string,
  requestId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const list = parseSubList(new URL(request.url).searchParams);
    const cursor = parseDateCursor(list.sort, list.cursor);

    const page = await listComments({
      workspaceId: auth.workspaceId,
      requestId,
      sort: list.sort,
      limit: list.limit,
      cursorValue: cursor.value,
      cursorId: cursor.id,
    });
    if (!page) throw apiNotFound(auth.requestId, "Request");

    const last = page.items[page.items.length - 1];
    return paginated(auth, page.items.map(serializeComment), {
      limit: list.limit,
      hasMore: page.hasMore,
      nextCursor:
        last && page.hasMore
          ? encodeCursor({
              sort: list.sort,
              value: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    return handleCreateComment(auth, requestId, await request.text());
  }

  throw methodNotAllowed(["GET", "POST"]);
}

async function handleCreateComment(
  auth: ApiAuth,
  requestId: string,
  bodyText: string,
): Promise<NextResponse> {
  const input = parseBody(commentCreateSchema, requireJsonBody(bodyText));
  const result = await createComment({
    workspaceId: auth.workspaceId,
    userId: actingUserId(auth),
    requestId,
    body: input.body,
    internal: input.internal,
  });

  if (!result.ok) {
    throw new ApiFailure(404, "not_found", result.error);
  }

  const page = await listComments({
    workspaceId: auth.workspaceId,
    requestId,
    sort: "newest",
    limit: 100,
    cursorValue: null,
    cursorId: null,
  });
  const created = page?.items.find((item) => item.id === result.id);
  return ok(auth, created ? serializeComment(created) : { id: result.id }, 201);
}

export async function handleVotes(
  auth: ApiAuth,
  request: Request,
  method: string,
  requestId: string,
) {
  const params = new URL(request.url).searchParams;

  if (method === "DELETE") {
    requireScope(auth, "write");
    const result = await setRequestVote({
      workspaceId: auth.workspaceId,
      requestId,
      customer: {
        id: params.get("customer_id") ?? undefined,
        external_id: params.get("external_id") ?? undefined,
        email: params.get("email") ?? undefined,
      },
      voted: false,
    });
    if (!result.ok) {
      throw new ApiFailure(
        result.status,
        result.status === 404 ? "not_found" : "invalid_request",
        result.error,
      );
    }
    return ok(auth, { voted: result.voted, vote_count: result.voteCount });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    const input = parseBody(voteSchema, requireJsonBody(await request.text()));
    const result = await setRequestVote({
      workspaceId: auth.workspaceId,
      requestId,
      customer: input.customer,
      voted: input.voted,
    });
    if (!result.ok) {
      throw new ApiFailure(
        result.status,
        result.status === 404 ? "not_found" : "invalid_request",
        result.error,
      );
    }
    return ok(auth, { voted: result.voted, vote_count: result.voteCount });
  }

  throw methodNotAllowed(["POST", "DELETE"]);
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

export async function handleChangelogs(auth: ApiAuth, request: Request, method: string) {
  if (method === "GET") {
    requireScope(auth, "read");
    const parsed = parseChangelogFilters(new URL(request.url).searchParams);
    if (!parsed.ok) throw new ApiFailure(400, "invalid_request", parsed.error);

    const page = await listReleases({ workspaceId: auth.workspaceId, filters: parsed.value });
    const items = page.items.map((item) =>
      serializeRelease(item.row, item.tags, item.authors, item.linkedRequestIds),
    );
    const last = page.items[page.items.length - 1];

    return paginated(auth, items, {
      limit: parsed.value.limit,
      hasMore: page.hasMore,
      nextCursor: last
        ? encodeCursor({
            sort: parsed.value.sort,
            value: releaseCursorValue(last, parsed.value.sort),
            id: last.row.id,
          })
        : null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    return handleCreateChangelog(auth, await request.text());
  }

  throw methodNotAllowed(["GET", "POST"]);
}

async function handleCreateChangelog(auth: ApiAuth, bodyText: string): Promise<NextResponse> {
  const parsed = parseBody(changelogCreateSchema, requireJsonBody(bodyText));
  const { product_id: productId, ...draft } = parsed;

  const product = await resolveProduct(auth.workspaceId, productId);
  if (!product) throw apiNotFound(auth.requestId, "Product");

  const result = await createChangelog({
    workspaceId: auth.workspaceId,
    productId: product.id,
    userId: actingUserId(auth),
    draft,
  });

  if (!result.ok) {
    if (result.status === 500) throw new Error(result.error);
    throw new ApiFailure(
      result.status,
      result.status === 404 ? "not_found" : result.status === 409 ? "conflict" : "validation_failed",
      result.error,
      { details: result.fieldErrors },
    );
  }

  const release = await getRelease(auth.workspaceId, result.releaseId);
  if (!release) throw new Error("Draft was created but could not be read back.");
  return ok(
    auth,
    serializeRelease(release.row, release.tags, release.authors, release.linkedRequestIds),
    201,
  );
}

export async function handleChangelog(
  auth: ApiAuth,
  request: Request,
  method: string,
  releaseId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const release = await getRelease(auth.workspaceId, releaseId);
    if (!release) throw apiNotFound(auth.requestId, "Changelog entry");
    return ok(
      auth,
      serializeRelease(release.row, release.tags, release.authors, release.linkedRequestIds),
    );
  }

  if (method === "PATCH") {
    requireScope(auth, "write");
    const existing = await getRelease(auth.workspaceId, releaseId);
    if (!existing) throw apiNotFound(auth.requestId, "Changelog entry");

    const draft = parseBody(changelogUpdateSchema, requireJsonBody(await request.text()));
    const result = await updateChangelog({
      workspaceId: auth.workspaceId,
      productId: existing.row.productId,
      userId: actingUserId(auth),
      releaseId,
      draft,
    });

    if (!result.ok) {
      if (result.status === 500) throw new Error(result.error);
      throw new ApiFailure(
        result.status,
        result.status === 404
          ? "not_found"
          : result.status === 409
            ? "conflict"
            : "validation_failed",
        result.error,
        { details: result.fieldErrors },
      );
    }

    const release = await getRelease(auth.workspaceId, releaseId);
    if (!release) throw new Error("Draft was updated but could not be read back.");
    return ok(
      auth,
      serializeRelease(release.row, release.tags, release.authors, release.linkedRequestIds),
    );
  }

  throw methodNotAllowed(["GET", "PATCH"]);
}

// ---------------------------------------------------------------------------
// Members and companies
// ---------------------------------------------------------------------------

export async function handleMembers(auth: ApiAuth, method: string) {
  if (method !== "GET") throw methodNotAllowed(["GET"]);
  requireScope(auth, "read");
  const members = await listMembers(auth.workspaceId);
  return paginated(auth, members.map(serializeMember), {
    limit: members.length,
    hasMore: false,
    nextCursor: null,
  });
}

export async function handleCompanies(auth: ApiAuth, request: Request, method: string) {
  if (method === "GET") {
    requireScope(auth, "read");
    const companies = await listCompanies({
      workspaceId: auth.workspaceId,
      query: (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200),
    });
    return paginated(auth, companies.map(serializeCompany), {
      limit: companies.length,
      hasMore: false,
      nextCursor: null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    const input = parseBody(companyCreateSchema, requireJsonBody(await request.text()));
    const id = await createCompany({
      workspaceId: auth.workspaceId,
      name: input.name,
      externalId: input.external_id ?? null,
      domain: input.domain ?? null,
      traits: input.traits ?? {},
    });
    const company = await getCompany(auth.workspaceId, id);
    return ok(auth, company ? serializeCompany(company) : { id }, 201);
  }

  throw methodNotAllowed(["GET", "POST"]);
}

export async function handleCompany(
  auth: ApiAuth,
  request: Request,
  method: string,
  companyId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const company = await getCompany(auth.workspaceId, companyId);
    if (!company) throw apiNotFound(auth.requestId, "Company");
    return ok(auth, {
      ...serializeCompany(company),
      customers: company.customers,
    });
  }

  if (method === "PATCH") {
    requireScope(auth, "write");
    const input = parseBody(companyUpdateSchema, requireJsonBody(await request.text()));
    const updated = await updateCompany(auth.workspaceId, companyId, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.external_id === undefined ? {} : { externalId: input.external_id }),
      ...(input.domain === undefined ? {} : { domain: input.domain }),
      ...(input.traits === undefined ? {} : { traits: input.traits }),
    });
    if (!updated) throw apiNotFound(auth.requestId, "Company");

    const company = await getCompany(auth.workspaceId, companyId);
    if (!company) throw apiNotFound(auth.requestId, "Company");
    return ok(auth, {
      ...serializeCompany(company),
      customers: company.customers,
    });
  }

  throw methodNotAllowed(["GET", "PATCH"]);
}

export async function handleCompanyCustomers(
  auth: ApiAuth,
  request: Request,
  method: string,
  companyId: string,
) {
  if (method !== "POST") throw methodNotAllowed(["POST"]);
  requireScope(auth, "write");

  const input = parseBody(companyCustomerSchema, requireJsonBody(await request.text()));
  const result = await addCompanyCustomer({
    workspaceId: auth.workspaceId,
    companyId,
    customer: input.customer,
    role: input.role ?? null,
  });
  if (!result.ok) {
    throw new ApiFailure(
      result.status,
      result.status === 404 ? "not_found" : "invalid_request",
      result.error,
    );
  }

  const company = await getCompany(auth.workspaceId, companyId);
  if (!company) throw apiNotFound(auth.requestId, "Company");
  return ok(auth, { ...serializeCompany(company), customers: company.customers }, 201);
}

// ---------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------

export async function handleConversations(auth: ApiAuth, request: Request, method: string) {
  if (method !== "GET") throw methodNotAllowed(["GET"]);
  requireScope(auth, "read");

  const parsed = parseConversationFilters(new URL(request.url).searchParams);
  if (!parsed.ok) throw new ApiFailure(400, "invalid_request", parsed.error);

  const page = await listConversations({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    filters: parsed.value,
  });
  const last = page.items[page.items.length - 1];

  return paginated(auth, page.items.map(serializeConversation), {
    limit: parsed.value.limit,
    hasMore: page.hasMore,
    nextCursor: last
      ? encodeCursor({
          sort: parsed.value.sort,
          value: conversationCursorValue(last, parsed.value.sort),
          id: last.id,
        })
      : null,
  });
}

export async function handleConversation(
  auth: ApiAuth,
  request: Request,
  method: string,
  conversationId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const conversation = await getConversation(auth.workspaceId, conversationId);
    if (!conversation) throw apiNotFound(auth.requestId, "Conversation");
    return ok(auth, serializeConversation(conversation));
  }

  if (method === "PATCH") {
    requireScope(auth, "write");
    const input = parseBody(conversationUpdateSchema, requireJsonBody(await request.text()));
    const result = await updateConversation({
      workspaceId: auth.workspaceId,
      conversationId,
      status: input.status,
      assigneeId: input.assignee_id,
    });
    if (!result.ok) {
      throw new ApiFailure(
        result.status,
        result.status === 404 ? "not_found" : "invalid_request",
        result.error,
      );
    }
    const conversation = await getConversation(auth.workspaceId, conversationId);
    if (!conversation) throw apiNotFound(auth.requestId, "Conversation");
    return ok(auth, serializeConversation(conversation));
  }

  throw methodNotAllowed(["GET", "PATCH"]);
}

export async function handleMessages(
  auth: ApiAuth,
  request: Request,
  method: string,
  conversationId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const list = parseSubList(new URL(request.url).searchParams);
    const cursor = parseDateCursor(list.sort, list.cursor);

    const page = await listMessages({
      workspaceId: auth.workspaceId,
      conversationId,
      sort: list.sort,
      limit: list.limit,
      cursorValue: cursor.value,
      cursorId: cursor.id,
    });
    if (!page) throw apiNotFound(auth.requestId, "Conversation");

    const last = page.items[page.items.length - 1];
    return paginated(auth, page.items.map(serializeMessage), {
      limit: list.limit,
      hasMore: page.hasMore,
      nextCursor:
        last && page.hasMore
          ? encodeCursor({
              sort: list.sort,
              value: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    return handleCreateMessage(auth, conversationId, await request.text(), "message");
  }

  throw methodNotAllowed(["GET", "POST"]);
}

export async function handleNotes(
  auth: ApiAuth,
  request: Request,
  method: string,
  conversationId: string,
) {
  if (method !== "POST") throw methodNotAllowed(["POST"]);
  requireScope(auth, "write");
  return handleCreateMessage(auth, conversationId, await request.text(), "note");
}

async function handleCreateMessage(
  auth: ApiAuth,
  conversationId: string,
  bodyText: string,
  kind: "message" | "note",
): Promise<NextResponse> {
  const input = parseBody(messageSchema, requireJsonBody(bodyText));
  const result = await appendMessage({
    workspaceId: auth.workspaceId,
    conversationId,
    userId: actingUserId(auth),
    body: input.body,
    kind,
  });

  if (!result.ok) {
    throw new ApiFailure(
      result.status,
      result.status === 404 ? "not_found" : "invalid_request",
      result.error,
    );
  }

  return apiJson(
    {
      data: {
        id: result.messageId,
        conversation_id: conversationId,
        kind,
        status: result.status,
      },
    },
    { status: 201, requestId: auth.requestId },
  );
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export async function handleCustomFields(
  auth: ApiAuth,
  request: Request,
  method: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const product = new URL(request.url).searchParams.get("product");
    const fields = await listCustomFieldDefinitions({
      workspaceId: auth.workspaceId,
      product: product && product.trim() !== "" ? product.trim() : null,
    });
    return paginated(auth, fields.map(serializeCustomField), {
      limit: fields.length,
      hasMore: false,
      nextCursor: null,
    });
  }

  if (method === "POST") {
    requireScope(auth, "write");
    const input = parseBody(customFieldCreateSchema, requireJsonBody(await request.text()));

    const product = await resolveProduct(auth.workspaceId, input.product_id);
    if (!product) throw apiNotFound(auth.requestId, "Product");

    const key = input.key?.trim() || customFieldKeyFromLabel(input.label);
    if (!isValidCustomFieldKey(key)) {
      throw new ApiFailure(400, "validation_failed", "Check the custom field.", {
        details: {
          key: [
            "Use lowercase letters, numbers and underscores, starting with a letter.",
          ],
        },
      });
    }

    const options =
      input.type === "select" ? normalizeCustomFieldOptions(input.options) : [];
    if (input.type === "select" && options.length === 0) {
      throw new ApiFailure(400, "validation_failed", "A select field needs options.", {
        details: { options: ["Add at least one option."] },
      });
    }

    const created = await createCustomFieldDefinition({
      workspaceId: auth.workspaceId,
      productId: product.id,
      key,
      label: input.label,
      description: input.description ?? null,
      type: input.type,
      options,
      required: input.required,
      position: input.position,
    });
    if (!created.ok) {
      throw new ApiFailure(409, "conflict", created.error);
    }

    const field = await getCustomFieldDefinition(auth.workspaceId, created.id);
    if (!field) throw new Error("Custom field was created but could not be read back.");
    return ok(auth, serializeCustomField(field), 201);
  }

  throw methodNotAllowed(["GET", "POST"]);
}

export async function handleCustomField(
  auth: ApiAuth,
  request: Request,
  method: string,
  fieldId: string,
) {
  if (method === "GET") {
    requireScope(auth, "read");
    const field = await getCustomFieldDefinition(auth.workspaceId, fieldId);
    if (!field) throw apiNotFound(auth.requestId, "Custom field");
    return ok(auth, serializeCustomField(field));
  }

  if (method === "PATCH") {
    requireScope(auth, "write");
    const input = parseBody(customFieldUpdateSchema, requireJsonBody(await request.text()));
    const existing = await getCustomFieldDefinition(auth.workspaceId, fieldId);
    if (!existing) throw apiNotFound(auth.requestId, "Custom field");

    const options =
      input.options === undefined ? undefined : normalizeCustomFieldOptions(input.options);
    if (existing.type === "select" && options !== undefined && options.length === 0) {
      throw new ApiFailure(400, "validation_failed", "A select field needs options.");
    }

    const updated = await updateCustomFieldDefinition(auth.workspaceId, fieldId, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(options === undefined ? {} : { options }),
      ...(input.required === undefined ? {} : { required: input.required }),
      ...(input.archived === undefined ? {} : { archived: input.archived }),
      ...(input.position === undefined ? {} : { position: input.position }),
    });
    if (!updated) throw apiNotFound(auth.requestId, "Custom field");

    const field = await getCustomFieldDefinition(auth.workspaceId, fieldId);
    if (!field) throw apiNotFound(auth.requestId, "Custom field");
    return ok(auth, serializeCustomField(field));
  }

  if (method === "DELETE") {
    requireScope(auth, "write");
    const deleted = await deleteCustomFieldDefinition(auth.workspaceId, fieldId);
    if (!deleted) throw apiNotFound(auth.requestId, "Custom field");
    return ok(auth, { id: fieldId, deleted: true });
  }

  throw methodNotAllowed(["GET", "PATCH", "DELETE"]);
}
