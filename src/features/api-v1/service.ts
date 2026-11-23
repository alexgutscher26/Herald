import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import { listCustomFieldsForProduct } from "@/db/queries/custom-fields";
import {
  boardTags,
  boards,
  customFields,
  customers,
  customerCompanies,
  customerCompanyMemberships,
  conversationMessages,
  conversations,
  feedbackComments,
  feedbackCustomFieldValues,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackPosts,
  feedbackPrioritisation,
  feedbackTagLinks,
  feedbackVotes,
  products,
  releaseAuthors,
  releaseFeedbackLinks,
  releaseTagLinks,
  releaseTags,
  releases,
  user,
  workspaceMembers,
} from "@/db/schema";
import { createReleaseDraft, updateReleaseDraft } from "@/features/releases/draft-service";
import type {
  ReleaseDraftCreateInput,
  ReleaseDraftUpdateInput,
} from "@/features/releases/draft-schema";
import { findSensitiveInfo, sensitiveInfoMessage } from "@/features/public/sensitive";
import { screenContent } from "@/features/moderation/screening";
import { upsertPendingReview } from "@/features/moderation/service";
import { queueFeedbackReplyNotifications } from "@/features/notifications/service";
import { appendTeamMessage, assignConversation, setConversationStatus } from "@/features/conversations/service";
import { replacePostTags } from "@/features/feedback/tags";
import {
  isCalendarDate,
  parseCustomFieldValues,
} from "@/features/feedback/custom-fields";
import { computeSignals, normalizeScaleValue } from "@/features/feedback/prioritisation";
import { normalizeEmail } from "@/lib/email";
import { emitWebhookEvent } from "@/features/webhooks/service";
import { bulkUpdateFeedbackStatuses } from "@/features/feedback/triage";
import { isUuid } from "./cursor";
import type {
  ChangelogFilters,
  ConversationFilters,
  RequestFilters,
} from "./filters";
import { hydrateRequestExtras } from "./request-extras";
import type { PrioritySignals } from "@/types";
import type {
  BoardRow,
  CommentRow,
  CompanyRow,
  ConversationRow,
  MemberRow,
  MessageRow,
  ReleaseRow,
  RequestRow,
  TagRow,
} from "./serialize";

/**
 * v1 data access.
 *
 * Every query starts from a workspace id taken from the bearer token and joins
 * through `products` (or uses a workspace-scoped table) so a guessed id from
 * another workspace resolves to `null`, never to a row. Handlers translate
 * that null into a uniform 404.
 */

export type Page<T> = { items: T[]; hasMore: boolean };

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function boardPredicate(value: string): SQL {
  return isUuid(value)
    ? (or(eq(boards.id, value), eq(boards.slug, value)) as SQL)
    : eq(boards.slug, value);
}

function tagPredicate(value: string): SQL {
  const match = isUuid(value)
    ? (or(eq(boardTags.id, value), eq(boardTags.name, value)) as SQL)
    : eq(boardTags.name, value);

  return inArray(
    feedbackPosts.id,
    db
      .select({ id: feedbackTagLinks.feedbackPostId })
      .from(feedbackTagLinks)
      .innerJoin(boardTags, eq(feedbackTagLinks.tagId, boardTags.id))
      .where(match),
  );
}

function customFieldPredicate(
  filters: { key: string; value: string }[],
): SQL | null {
  if (filters.length === 0) return null;

  const clauses = filters.map(({ key, value }) => {
    const pattern = likePattern(value);
    const numeric = value.trim() !== "" && Number.isFinite(Number(value));
    const isDate = isCalendarDate(value);

    return sql`exists (
      select 1 from ${feedbackCustomFieldValues}
      inner join ${customFields}
        on ${customFields.id} = ${feedbackCustomFieldValues.fieldId}
        and ${customFields.productId} = ${feedbackPosts.productId}
      where ${feedbackCustomFieldValues.feedbackPostId} = ${feedbackPosts.id}
        and ${customFields.key} = ${key}
        and (
          (${customFields.type} = 'text'
            and ${feedbackCustomFieldValues.textValue} ilike ${pattern})
          or (${customFields.type} = 'select'
            and ${feedbackCustomFieldValues.textValue} = ${value})
          ${numeric ? sql`or ${feedbackCustomFieldValues.numberValue} = ${Number(value)}` : sql``}
          ${isDate ? sql`or ${feedbackCustomFieldValues.dateValue} = ${value}::date` : sql``}
        )
    )`;
  });

  return and(...clauses) as SQL;
}

/**
 * Resolve the storage type for a custom-field sort key across a workspace.
 *
 * Text and select are both ordered as text; dates stay ISO-8601, so their text
 * order is chronological. A key used by products with different storage types
 * is rejected rather than silently ordered by an arbitrary cast.
 */
export async function resolveRequestCustomSortType(
  workspaceId: string,
  key: string,
): Promise<"number" | "text" | "ambiguous" | null> {
  const rows = await db
    .select({ type: customFields.type })
    .from(customFields)
    .innerJoin(products, eq(customFields.productId, products.id))
    .where(and(eq(products.workspaceId, workspaceId), eq(customFields.key, key)));

  const kinds = new Set(rows.map((row) => (row.type === "number" ? "number" : "text")));
  if (kinds.size === 0) return null;
  if (kinds.size > 1) return "ambiguous";
  return kinds.has("number") ? "number" : "text";
}

function customFieldSortExpression(key: string, type: "number" | "text"): SQL {
  if (type === "number") {
    return sql<number | null>`(
      select ${feedbackCustomFieldValues.numberValue}
      from ${feedbackCustomFieldValues}
      inner join ${customFields}
        on ${customFields.id} = ${feedbackCustomFieldValues.fieldId}
        and ${customFields.productId} = ${feedbackPosts.productId}
      where ${feedbackCustomFieldValues.feedbackPostId} = ${feedbackPosts.id}
        and ${customFields.key} = ${key}
        and ${customFields.type} = 'number'
      limit 1
    )`;
  }

  return sql<string | null>`(
    select coalesce(${feedbackCustomFieldValues.textValue}, ${feedbackCustomFieldValues.dateValue}::text)
    from ${feedbackCustomFieldValues}
    inner join ${customFields}
      on ${customFields.id} = ${feedbackCustomFieldValues.fieldId}
      and ${customFields.productId} = ${feedbackPosts.productId}
    where ${feedbackCustomFieldValues.feedbackPostId} = ${feedbackPosts.id}
      and ${customFields.key} = ${key}
      and ${customFields.type} in ('text', 'select', 'date')
    limit 1
  )`;
}

function authorPredicate(value: string): SQL {
  const clauses: SQL[] = [eq(customers.externalId, value)];
  if (value.includes("@")) {
    clauses.push(eq(customers.emailNormalized, value.trim().toLowerCase()));
  }
  if (isUuid(value)) clauses.push(eq(customers.id, value));
  return or(...clauses) as SQL;
}

const requestVoteCount = sql<number>`(
  (select count(*)::int from ${feedbackCustomerVotes}
    where ${feedbackCustomerVotes.feedbackPostId} = ${feedbackPosts.id})
  + (select count(*)::int from ${feedbackVotes}
    where ${feedbackVotes.feedbackPostId} = ${feedbackPosts.id})
  + ${feedbackPosts.importedVoteCount}
)`;

const requestCommentCount = sql<number>`(
  select count(*)::int from ${feedbackComments}
  where ${feedbackComments.feedbackPostId} = ${feedbackPosts.id}
)`;

type RequestSelection = {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  boardId: string | null;
  boardSlug: string | null;
  boardName: string | null;
  title: string;
  body: string;
  status: string;
  category: string;
  source: string;
  authorCustomerId: string | null;
  authorCustomerName: string | null;
  authorCustomerEmail: string | null;
  authorCustomerExternalId: string | null;
  authorId: string | null;
  authorLabel: string | null;
  authorEmail: string | null;
  authorCompany: string | null;
  impact: number | null;
  businessValue: number | null;
  effort: number | null;
  voteCount: number;
  commentCount: number;
  archivedAt: Date | null;
  hiddenAt: Date | null;
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function requestSelection() {
  return {
    id: feedbackPosts.id,
    productId: products.id,
    productSlug: products.slug,
    productName: products.name,
    boardId: boards.id,
    boardSlug: boards.slug,
    boardName: boards.name,
    title: feedbackPosts.title,
    body: feedbackPosts.body,
    status: feedbackPosts.status,
    category: feedbackPosts.category,
    source: feedbackPosts.source,
    authorCustomerId: feedbackPosts.authorCustomerId,
    authorCustomerName: customers.name,
    authorCustomerEmail: customers.email,
    authorCustomerExternalId: customers.externalId,
    authorId: feedbackPosts.authorId,
    authorLabel: feedbackPosts.authorLabel,
    authorEmail: feedbackPosts.authorEmail,
    authorCompany: feedbackPosts.authorCompany,
    impact: feedbackPrioritisation.impact,
    businessValue: feedbackPrioritisation.businessValue,
    effort: feedbackPrioritisation.effort,
    voteCount: requestVoteCount,
    commentCount: requestCommentCount,
    archivedAt: feedbackPosts.archivedAt,
    hiddenAt: feedbackPosts.hiddenAt,
    mergedIntoId: feedbackPosts.mergedIntoId,
    createdAt: feedbackPosts.createdAt,
    updatedAt: feedbackPosts.updatedAt,
  };
}

async function selectRequestRows(input: {
  workspaceId: string;
  conditions: SQL[];
  order: SQL[];
  limit: number;
}): Promise<RequestSelection[]> {
  const rows = await db
    .select(requestSelection())
    .from(feedbackPosts)
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .leftJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .leftJoin(
      feedbackPrioritisation,
      eq(feedbackPrioritisation.feedbackPostId, feedbackPosts.id),
    )
    .where(and(eq(products.workspaceId, input.workspaceId), ...input.conditions))
    .orderBy(...input.order)
    .limit(input.limit);

  return rows as unknown as RequestSelection[];
}

async function tagsForRequestIds(
  workspaceId: string,
  ids: string[],
): Promise<Map<string, { id: string; name: string; color: string | null }[]>> {
  const map = new Map<string, { id: string; name: string; color: string | null }[]>();
  if (ids.length === 0) return map;

  const rows = await db
    .select({
      postId: feedbackTagLinks.feedbackPostId,
      id: boardTags.id,
      name: boardTags.name,
      color: boardTags.color,
    })
    .from(feedbackTagLinks)
    .innerJoin(boardTags, eq(feedbackTagLinks.tagId, boardTags.id))
    .innerJoin(feedbackPosts, eq(feedbackTagLinks.feedbackPostId, feedbackPosts.id))
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .where(
      and(eq(products.workspaceId, workspaceId), inArray(feedbackTagLinks.feedbackPostId, ids)),
    )
    .orderBy(asc(boardTags.position), asc(boardTags.name));

  for (const row of rows) {
    const list = map.get(row.postId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.postId, list);
  }
  return map;
}

export type RequestPageItem = {
  row: RequestRow;
  tags: { id: string; name: string; color: string | null }[];
  customFields: Record<string, string | number>;
  signals: PrioritySignals;
};

function fallbackSignals(row: RequestSelection): PrioritySignals {
  return computeSignals({
    impact: row.impact,
    businessValue: row.businessValue,
    effort: row.effort,
    requesterCount: 0,
    knownArr: null,
  });
}

export type RequestPage = Page<RequestPageItem>;

function requestSortValue(row: RequestRow, sort: RequestFilters["sort"]): string {
  switch (sort) {
    case "votes":
      return String(row.voteCount);
    case "updated":
      return row.updatedAt.toISOString();
    case "oldest":
    case "newest":
    default:
      return row.createdAt.toISOString();
  }
}

export function requestCursorValue(
  item: RequestPageItem,
  filters: RequestFilters,
): string {
  if (filters.customSort) {
    const value = item.customFields[filters.customSort.key];
    // The empty string is the null marker: stored custom-field values are
    // never empty because blank input deletes the value row.
    return value === undefined ? "" : String(value);
  }
  return requestSortValue(item.row, filters.sort);
}

export async function listRequests(input: {
  workspaceId: string;
  filters: RequestFilters;
  /** Pre-resolved by the handler so an unknown/ambiguous key is a 400. */
  customSortType?: "number" | "text" | undefined;
}): Promise<RequestPage> {
  const conditions: SQL[] = [];

  if (!input.filters.includeArchived) conditions.push(isNull(feedbackPosts.archivedAt));
  if (!input.filters.includeMerged) conditions.push(isNull(feedbackPosts.mergedIntoId));
  if (input.filters.status) {
    conditions.push(
      eq(feedbackPosts.status, input.filters.status as "open"),
    );
  }
  if (input.filters.board) conditions.push(boardPredicate(input.filters.board));
  if (input.filters.tag) conditions.push(tagPredicate(input.filters.tag));
  if (input.filters.author) conditions.push(authorPredicate(input.filters.author));
  const customFieldClause = customFieldPredicate(input.filters.customFields);
  if (customFieldClause) conditions.push(customFieldClause);
  if (input.filters.updatedSince) {
    conditions.push(gte(feedbackPosts.updatedAt, input.filters.updatedSince));
  }
  if (input.filters.query) {
    const pattern = likePattern(input.filters.query);
    conditions.push(
      or(ilike(feedbackPosts.title, pattern), ilike(feedbackPosts.body, pattern)) as SQL,
    );
  }

  const cursor = input.filters.cursor;
  let order: SQL[];
  const customSort = input.filters.customSort;

  if (customSort) {
    const resolved =
      input.customSortType ?? (await resolveRequestCustomSortType(input.workspaceId, customSort.key));
    const type = resolved === "number" || resolved === "text" ? resolved : null;

    if (!type) {
      // The API handler rejects this before reaching here; direct callers get
      // an empty, deterministic page rather than an unsafe ordering.
      conditions.push(sql`false`);
      order = [desc(feedbackPosts.createdAt), desc(feedbackPosts.id)];
    } else {
      const expression = customFieldSortExpression(customSort.key, type);
      const ascending = customSort.direction === "asc";

      order = [
        sql`(${expression}) is null asc`,
        ascending ? sql`${expression} asc` : sql`${expression} desc`,
        ascending ? sql`${feedbackPosts.id} asc` : sql`${feedbackPosts.id} desc`,
      ];

      if (cursor) {
        if (cursor.value === "") {
          conditions.push(
            sql`(${expression}) is null and ${feedbackPosts.id} ${
              ascending ? sql`>` : sql`<`
            } ${cursor.id}`,
          );
        } else if (type === "number") {
          const value = Number(cursor.value);
          if (!Number.isFinite(value)) {
            conditions.push(sql`false`);
          } else {
            conditions.push(
              sql`((${expression}) ${
                ascending ? sql`>` : sql`<`
              } ${value} or (${expression}) is null or ((${expression}) = ${value} and ${
                feedbackPosts.id
              } ${ascending ? sql`>` : sql`<`} ${cursor.id}))`,
            );
          }
        } else {
          conditions.push(
            sql`((${expression}) ${
              ascending ? sql`>` : sql`<`
            } ${cursor.value} or (${expression}) is null or ((${expression}) = ${
              cursor.value
            } and ${feedbackPosts.id} ${ascending ? sql`>` : sql`<`} ${cursor.id}))`,
          );
        }
      }
    }
  } else {
  switch (input.filters.sort) {
    case "oldest":
      order = [asc(feedbackPosts.createdAt), asc(feedbackPosts.id)];
      if (cursor) {
        const value = new Date(cursor.value);
        conditions.push(
          or(
            gt(feedbackPosts.createdAt, value),
            and(eq(feedbackPosts.createdAt, value), gt(feedbackPosts.id, cursor.id)),
          ) as SQL,
        );
      }
      break;
    case "updated":
      order = [desc(feedbackPosts.updatedAt), desc(feedbackPosts.id)];
      if (cursor) {
        const value = new Date(cursor.value);
        conditions.push(
          or(
            lt(feedbackPosts.updatedAt, value),
            and(eq(feedbackPosts.updatedAt, value), lt(feedbackPosts.id, cursor.id)),
          ) as SQL,
        );
      }
      break;
    case "votes":
      order = [desc(requestVoteCount), desc(feedbackPosts.id)];
      if (cursor) {
        const value = Number.parseInt(cursor.value, 10);
        if (!Number.isFinite(value)) {
          conditions.push(sql`false`);
          break;
        }
        conditions.push(
          sql`(${requestVoteCount}) < ${value}
            or ((${requestVoteCount}) = ${value} and ${feedbackPosts.id} < ${cursor.id})`,
        );
      }
      break;
    case "newest":
    default:
      order = [desc(feedbackPosts.createdAt), desc(feedbackPosts.id)];
      if (cursor) {
        const value = new Date(cursor.value);
        conditions.push(
          or(
            lt(feedbackPosts.createdAt, value),
            and(eq(feedbackPosts.createdAt, value), lt(feedbackPosts.id, cursor.id)),
          ) as SQL,
        );
      }
      break;
  }
  }

  const rows = await selectRequestRows({
    workspaceId: input.workspaceId,
    conditions,
    order,
    limit: input.filters.limit + 1,
  });

  const hasMore = rows.length > input.filters.limit;
  const page = rows.slice(0, input.filters.limit);
  const tags = await tagsForRequestIds(
    input.workspaceId,
    page.map((row) => row.id),
  );

  const extras = await hydrateRequestExtras(
    input.workspaceId,
    page.map((row) => ({
      id: row.id,
      productId: row.productId,
      authorCustomerId: row.authorCustomerId,
      impact: row.impact,
      businessValue: row.businessValue,
      effort: row.effort,
    })),
  );

  return {
    items: page.map((row) => ({
      row: row as RequestRow,
      tags: tags.get(row.id) ?? [],
      customFields: extras.get(row.id)?.customFields ?? {},
      signals: extras.get(row.id)?.signals ?? fallbackSignals(row),
    })),
    hasMore,
  };
}

export async function getRequest(
  workspaceId: string,
  requestId: string,
): Promise<RequestPageItem | null> {
  if (!isUuid(requestId)) return null;

  const rows = await selectRequestRows({
    workspaceId,
    conditions: [eq(feedbackPosts.id, requestId)],
    order: [desc(feedbackPosts.createdAt)],
    limit: 1,
  });
  const row = rows[0];
  if (!row) return null;

  const tags = await tagsForRequestIds(workspaceId, [row.id]);
  const extras = await hydrateRequestExtras(workspaceId, [
    {
      id: row.id,
      productId: row.productId,
      authorCustomerId: row.authorCustomerId,
      impact: row.impact,
      businessValue: row.businessValue,
      effort: row.effort,
    },
  ]);
  return {
    row: row as RequestRow,
    tags: tags.get(row.id) ?? [],
    customFields: extras.get(row.id)?.customFields ?? {},
    signals: extras.get(row.id)?.signals ?? fallbackSignals(row),
  };
}

export async function resolveBoard(workspaceId: string, boardId: string) {
  if (!isUuid(boardId)) return null;
  const rows = await db
    .select({
      id: boards.id,
      productId: boards.productId,
      slug: boards.slug,
      name: boards.name,
      settings: boards.settings,
      visibility: boards.visibility,
      guestPosting: boards.guestPosting,
      archivedAt: boards.archivedAt,
    })
    .from(boards)
    .innerJoin(products, eq(boards.productId, products.id))
    .where(and(eq(boards.id, boardId), eq(products.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveProduct(workspaceId: string, productId: string) {
  if (!isUuid(productId)) return null;
  const rows = await db
    .select({ id: products.id, name: products.name, slug: products.slug })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveCustomer(
  workspaceId: string,
  input: { id?: string | undefined; external_id?: string | undefined; email?: string | undefined; name?: string | undefined },
): Promise<{ id: string; name: string | null; email: string | null } | null> {
  if (input.id) {
    if (!isUuid(input.id)) return null;
    const rows = await db
      .select({ id: customers.id, name: customers.name, email: customers.email })
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  const email = input.email?.trim() || null;
  const emailNormalized = email ? normalizeEmail(email) : null;
  const externalId = input.external_id?.trim() || null;
  if (!email && !externalId) return null;

  const match = emailNormalized
    ? eq(customers.emailNormalized, emailNormalized)
    : eq(customers.externalId, externalId as string);

  const existing = await db
    .select({ id: customers.id, name: customers.name, email: customers.email })
    .from(customers)
    .where(and(eq(customers.workspaceId, workspaceId), match))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(customers)
    .values({
      workspaceId,
      email,
      emailNormalized,
      externalId,
      name: input.name?.trim() || null,
    })
    .onConflictDoNothing()
    .returning({ id: customers.id, name: customers.name, email: customers.email });

  if (inserted[0]) return inserted[0];

  // A concurrent insert won the race; read the winning row.
  const again = await db
    .select({ id: customers.id, name: customers.name, email: customers.email })
    .from(customers)
    .where(and(eq(customers.workspaceId, workspaceId), match))
    .limit(1);
  return again[0] ?? null;
}

// ---------------------------------------------------------------------------
// Boards and tags
// ---------------------------------------------------------------------------

export type BoardPage = { items: BoardRow[]; hasMore: false };

export async function listBoards(input: {
  workspaceId: string;
  sort: "position" | "name" | "newest";
  includeArchived: boolean;
}): Promise<BoardPage> {
  const order =
    input.sort === "name"
      ? [asc(boards.name), asc(boards.id)]
      : input.sort === "newest"
        ? [desc(boards.createdAt), desc(boards.id)]
        : [asc(boards.position), asc(boards.name), asc(boards.id)];

  const conditions: SQL[] = [eq(products.workspaceId, input.workspaceId)];
  if (!input.includeArchived) conditions.push(isNull(boards.archivedAt));

  const rows = await db
    .select({
      id: boards.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      name: boards.name,
      slug: boards.slug,
      description: boards.description,
      icon: boards.icon,
      color: boards.color,
      visibility: boards.visibility,
      guestPosting: boards.guestPosting,
      settings: boards.settings,
      position: boards.position,
      archivedAt: boards.archivedAt,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      requestCount: sql<number>`(
        select count(*)::int from ${feedbackPosts}
        where ${feedbackPosts.boardId} = ${boards.id}
          and ${feedbackPosts.archivedAt} is null
          and ${feedbackPosts.mergedIntoId} is null
      )`,
    })
    .from(boards)
    .innerJoin(products, eq(boards.productId, products.id))
    .where(and(...conditions))
    .orderBy(...order);

  return { items: rows as BoardRow[], hasMore: false };
}

export async function getBoard(workspaceId: string, boardId: string): Promise<BoardRow | null> {
  if (!isUuid(boardId)) return null;
  const rows = await db
    .select({
      id: boards.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      name: boards.name,
      slug: boards.slug,
      description: boards.description,
      icon: boards.icon,
      color: boards.color,
      visibility: boards.visibility,
      guestPosting: boards.guestPosting,
      settings: boards.settings,
      position: boards.position,
      archivedAt: boards.archivedAt,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      requestCount: sql<number>`(
        select count(*)::int from ${feedbackPosts}
        where ${feedbackPosts.boardId} = ${boards.id}
          and ${feedbackPosts.archivedAt} is null
          and ${feedbackPosts.mergedIntoId} is null
      )`,
    })
    .from(boards)
    .innerJoin(products, eq(boards.productId, products.id))
    .where(and(eq(boards.id, boardId), eq(products.workspaceId, workspaceId)))
    .limit(1);
  return (rows[0] as BoardRow | undefined) ?? null;
}

export async function createBoard(input: {
  workspaceId: string;
  productId: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "public" | "private";
  guestPosting: boolean;
  settings: BoardRow["settings"];
  position: number;
}): Promise<string> {
  const inserted = await db
    .insert(boards)
    .values({
      productId: input.productId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      visibility: input.visibility,
      guestPosting: input.guestPosting,
      settings: input.settings,
      position: input.position,
    })
    .returning({ id: boards.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("Board insert returned no row.");
  return id;
}

export async function updateBoard(
  workspaceId: string,
  boardId: string,
  patch: {
    name?: string;
    slug?: string;
    description?: string | null;
    visibility?: "public" | "private";
    guestPosting?: boolean;
    settings?: BoardRow["settings"];
    position?: number;
    archived?: boolean;
  },
): Promise<boolean> {
  const existing = await getBoard(workspaceId, boardId);
  if (!existing) return false;

  await db
    .update(boards)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.slug === undefined ? {} : { slug: patch.slug }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
      ...(patch.guestPosting === undefined ? {} : { guestPosting: patch.guestPosting }),
      ...(patch.settings === undefined ? {} : { settings: patch.settings }),
      ...(patch.position === undefined ? {} : { position: patch.position }),
      ...(patch.archived === undefined
        ? {}
        : { archivedAt: patch.archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(boards.id, boardId));

  return true;
}

export async function listTags(input: {
  workspaceId: string;
  board: string | null;
  product: string | null;
}): Promise<TagRow[]> {
  const conditions: SQL[] = [eq(products.workspaceId, input.workspaceId)];

  if (input.board) {
    conditions.push(
      isUuid(input.board)
        ? (or(eq(boards.id, input.board), eq(boards.slug, input.board)) as SQL)
        : eq(boards.slug, input.board),
    );
  }
  if (input.product) {
    conditions.push(
      isUuid(input.product)
        ? (or(eq(products.id, input.product), eq(products.slug, input.product)) as SQL)
        : eq(products.slug, input.product),
    );
  }

  const rows = await db
    .select({
      id: boardTags.id,
      productId: boardTags.productId,
      boardId: boardTags.boardId,
      name: boardTags.name,
      color: boardTags.color,
      position: boardTags.position,
      createdAt: boardTags.createdAt,
    })
    .from(boardTags)
    .innerJoin(boards, eq(boardTags.boardId, boards.id))
    .innerJoin(products, eq(boardTags.productId, products.id))
    .where(and(...conditions))
    .orderBy(asc(boardTags.position), asc(boardTags.name));

  return rows;
}

export async function createTag(input: {
  workspaceId: string;
  boardId: string;
  name: string;
  color: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const board = await resolveBoard(input.workspaceId, input.boardId);
  if (!board) return { ok: false, error: "Board not found." };

  const result = await db
    .insert(boardTags)
    .values({
      boardId: board.id,
      productId: board.productId,
      name: input.name,
      color: input.color,
      position: 0,
    })
    .onConflictDoNothing()
    .returning({ id: boardTags.id });

  const id = result[0]?.id;
  if (!id) return { ok: false, error: "That board already has a tag with this name." };
  return { ok: true, id };
}

export async function deleteTag(workspaceId: string, tagId: string): Promise<boolean> {
  if (!isUuid(tagId)) return false;
  const deleted = await db
    .delete(boardTags)
    .where(
      and(
        eq(boardTags.id, tagId),
        inArray(
          boardTags.productId,
          db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.workspaceId, workspaceId)),
        ),
      ),
    )
    .returning({ id: boardTags.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export type CustomFieldRecord = typeof customFields.$inferSelect & {
  productSlug: string;
};

export async function listCustomFieldDefinitions(input: {
  workspaceId: string;
  product: string | null;
}): Promise<CustomFieldRecord[]> {
  const conditions: SQL[] = [eq(products.workspaceId, input.workspaceId)];
  if (input.product) {
    conditions.push(
      isUuid(input.product)
        ? (or(eq(products.id, input.product), eq(products.slug, input.product)) as SQL)
        : eq(products.slug, input.product),
    );
  }

  const rows = await db
    .select({ field: customFields, productSlug: products.slug })
    .from(customFields)
    .innerJoin(products, eq(customFields.productId, products.id))
    .where(and(...conditions))
    .orderBy(asc(customFields.position), asc(customFields.label));

  return rows.map((row) => ({ ...row.field, productSlug: row.productSlug }));
}

export async function getCustomFieldDefinition(
  workspaceId: string,
  fieldId: string,
): Promise<CustomFieldRecord | null> {
  if (!isUuid(fieldId)) return null;
  const rows = await db
    .select({ field: customFields, productSlug: products.slug })
    .from(customFields)
    .innerJoin(products, eq(customFields.productId, products.id))
    .where(and(eq(customFields.id, fieldId), eq(products.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.field, productSlug: row.productSlug } : null;
}

export async function createCustomFieldDefinition(input: {
  workspaceId: string;
  productId: string;
  key: string;
  label: string;
  description: string | null;
  type: "text" | "number" | "select" | "date";
  options: string[];
  required: boolean;
  position?: number | undefined;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const product = await resolveProduct(input.workspaceId, input.productId);
  if (!product) return { ok: false, error: "Product not found." };

  const inserted = await db
    .insert(customFields)
    .values({
      productId: product.id,
      key: input.key,
      label: input.label,
      description: input.description,
      type: input.type,
      options: input.type === "select" ? input.options : [],
      required: input.required,
      position: input.position ?? 0,
    })
    .onConflictDoNothing()
    .returning({ id: customFields.id });

  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: "This product already has a field with that key." };
  return { ok: true, id };
}

export async function updateCustomFieldDefinition(
  workspaceId: string,
  fieldId: string,
  patch: {
    label?: string;
    description?: string | null;
    options?: string[];
    required?: boolean;
    archived?: boolean;
    position?: number;
  },
): Promise<boolean> {
  const existing = await getCustomFieldDefinition(workspaceId, fieldId);
  if (!existing) return false;

  await db
    .update(customFields)
    .set({
      ...(patch.label === undefined ? {} : { label: patch.label }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.options === undefined ? {} : { options: patch.options }),
      ...(patch.required === undefined ? {} : { required: patch.required }),
      ...(patch.position === undefined ? {} : { position: patch.position }),
      ...(patch.archived === undefined
        ? {}
        : { archivedAt: patch.archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(customFields.id, fieldId));

  return true;
}

export async function deleteCustomFieldDefinition(
  workspaceId: string,
  fieldId: string,
): Promise<boolean> {
  if (!isUuid(fieldId)) return false;
  const deleted = await db
    .delete(customFields)
    .where(
      and(
        eq(customFields.id, fieldId),
        inArray(
          customFields.productId,
          db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.workspaceId, workspaceId)),
        ),
      ),
    )
    .returning({ id: customFields.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Requests, comments and votes
// ---------------------------------------------------------------------------

export async function createRequest(input: {
  workspaceId: string;
  userId: string;
  boardId: string;
  title: string;
  body: string;
  category: "feature_request" | "bug" | "improvement" | "question";
  status?: "open" | "under_review" | "planned" | "in_progress" | "shipped" | "closed" | undefined;
  tagIds?: string[] | undefined;
  customFields?: Record<string, unknown> | undefined;
  customer?: { id?: string | undefined; external_id?: string | undefined; email?: string | undefined; name?: string | undefined } | undefined;
}): Promise<
  | { ok: true; id: string; visibility: "published" | "awaiting_review" }
  | { ok: false; status: 400 | 404; error: string; details?: unknown }
> {
  const board = await resolveBoard(input.workspaceId, input.boardId);
  if (!board) return { ok: false, status: 404, error: "Board not found." };

  if (input.customer) {
    if (board.settings.moderation.blockSensitiveInfo) {
      const findings = findSensitiveInfo(`${input.title}\n${input.body}`);
      if (findings.length > 0) {
        return {
          ok: false,
          status: 400,
          error: sensitiveInfoMessage(findings),
          details: { body: [sensitiveInfoMessage(findings)] },
        };
      }
    }
  }

  if (input.tagIds && input.tagIds.length > 0) {
    const valid = await db
      .select({ id: boardTags.id })
      .from(boardTags)
      .where(
        and(
          eq(boardTags.boardId, board.id),
          inArray(boardTags.id, [...new Set(input.tagIds)]),
        ),
      );
    if (valid.length !== new Set(input.tagIds).size) {
      return {
        ok: false,
        status: 400,
        error: "Choose tags from this request's board.",
        details: { tag_ids: ["Choose tags from this request's board."] },
      };
    }
  }

  const author = input.customer
    ? await resolveCustomer(input.workspaceId, input.customer)
    : null;
  if (input.customer && !author) {
    return {
      ok: false,
      status: 400,
      error: "A customer needs an `id`, `external_id` or `email`.",
      details: { customer: ["Supply an id, external_id or email."] },
    };
  }

  const customFieldDefinitions =
    input.customFields === undefined
      ? []
      : await listCustomFieldsForProduct(board.productId, { includeArchived: false });
  const parsedCustomFields = parseCustomFieldValues(
    customFieldDefinitions,
    input.customFields ?? {},
  );
  if (!parsedCustomFields.ok) {
    return {
      ok: false,
      status: 400,
      error: "Check the custom fields.",
      details: parsedCustomFields.errors,
    };
  }

  const screening = author
    ? await screenContent({ title: input.title, body: input.body, images: [] })
    : null;
  const awaitingReview = author
    ? board.settings.moderation.requireApproval !== "none" ||
      (screening?.reasons.length ?? 0) > 0
    : false;

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(feedbackPosts)
      .values({
        productId: board.productId,
        boardId: board.id,
        authorCustomerId: author?.id ?? null,
        authorId: author ? null : input.userId,
        authorLabel: author?.name?.trim() || null,
        title: input.title,
        body: input.body,
        category: input.category,
        status: input.status ?? "open",
        source: "other",
      })
      .returning({ id: feedbackPosts.id });

    const post = inserted[0];
    if (!post) throw new Error("Request insert returned no row.");

    if (input.tagIds && input.tagIds.length > 0) {
      await tx.insert(feedbackTagLinks).values(
        [...new Set(input.tagIds)].map((tagId) => ({
          feedbackPostId: post.id,
          tagId,
          productId: board.productId,
        })),
      );
    }

    const customFieldRows = customFieldDefinitions.flatMap((field) => {
      if (!parsedCustomFields.values.has(field.id)) return [];
      const value = parsedCustomFields.values.get(field.id) as string | number;
      return [
        {
          productId: board.productId,
          feedbackPostId: post.id,
          fieldId: field.id,
          textValue:
            field.type === "text" || field.type === "select" ? String(value) : null,
          numberValue: field.type === "number" ? Number(value) : null,
          dateValue: field.type === "date" ? String(value) : null,
        },
      ];
    });
    if (customFieldRows.length > 0) {
      await tx.insert(feedbackCustomFieldValues).values(customFieldRows);
    }

    if (author && (awaitingReview || (screening?.reasons.length ?? 0) > 0)) {
      await upsertPendingReview(tx, {
        productId: board.productId,
        contentType: "feedback_post",
        contentId: post.id,
        reasons: screening?.reasons ?? [],
        checks: screening?.checks ?? {},
      });
    }

    if (author) {
      await tx
        .insert(feedbackFollowers)
        .values({
          feedbackPostId: post.id,
          customerId: author.id,
          source: "api",
        })
        .onConflictDoNothing();
    }

    return post;
  });

  const visibility = awaitingReview ? "awaiting_review" : "published";
  await emitWebhookEvent({
    workspaceId: input.workspaceId,
    event: "request.created",
    data: {
      request_id: created.id,
      board_id: board.id,
      title: input.title,
      status: input.status ?? "open",
      visibility,
    },
  });

  return { ok: true, id: created.id, visibility };
}

export async function updateRequest(input: {
  workspaceId: string;
  userId: string;
  requestId: string;
  title?: string | undefined;
  body?: string | undefined;
  category?: "feature_request" | "bug" | "improvement" | "question" | undefined;
  status?: "open" | "under_review" | "planned" | "in_progress" | "shipped" | "closed" | undefined;
  tagIds?: string[] | undefined;
  hidden?: boolean | undefined;
  customFields?: Record<string, unknown> | undefined;
  impact?: number | null | undefined;
  businessValue?: number | null | undefined;
  effort?: number | null | undefined;
}): Promise<{ ok: true } | { ok: false; status: 404 | 400; error: string }> {
  const existing = await getRequest(input.workspaceId, input.requestId);
  if (!existing) return { ok: false, status: 404, error: "Request not found." };

  const post = existing.row;
  const now = new Date();

  if (input.status) {
    await bulkUpdateFeedbackStatuses({
      productId: post.productId,
      postIds: [post.id],
      status: input.status,
      now,
    });
  }

  if (
    input.title !== undefined ||
    input.body !== undefined ||
    input.category !== undefined ||
    input.hidden !== undefined
  ) {
    await db
      .update(feedbackPosts)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.hidden === undefined
          ? {}
          : {
              hiddenAt: input.hidden ? now : null,
              hiddenBy: input.hidden ? input.userId : null,
            }),
        updatedAt: now,
      })
      .where(
        and(eq(feedbackPosts.id, post.id), eq(feedbackPosts.productId, post.productId)),
      );
  }

  if (input.tagIds !== undefined) {
    const result = await replacePostTags({
      productId: post.productId,
      postId: post.id,
      tagIds: input.tagIds,
    });
    if (!result.ok) return { ok: false, status: 400, error: result.error };
  }

  if (input.customFields !== undefined) {
    const definitions = await listCustomFieldsForProduct(post.productId, {
      includeArchived: false,
    });
    const parsed = parseCustomFieldValues(definitions, input.customFields);
    if (!parsed.ok) return { ok: false, status: 400, error: "Check the custom fields." };

    await db.transaction(async (tx) => {
      await tx
        .delete(feedbackCustomFieldValues)
        .where(eq(feedbackCustomFieldValues.feedbackPostId, post.id));

      const rows = definitions.flatMap((field) => {
        if (!parsed.values.has(field.id)) return [];
        const value = parsed.values.get(field.id) as string | number;
        return [
          {
            productId: post.productId,
            feedbackPostId: post.id,
            fieldId: field.id,
            textValue:
              field.type === "text" || field.type === "select" ? String(value) : null,
            numberValue: field.type === "number" ? Number(value) : null,
            dateValue: field.type === "date" ? String(value) : null,
          },
        ];
      });

      if (rows.length > 0) {
        await tx.insert(feedbackCustomFieldValues).values(rows);
      }
    });
  }

  if (
    input.impact !== undefined ||
    input.businessValue !== undefined ||
    input.effort !== undefined
  ) {
    const current = (
      await db
        .select()
        .from(feedbackPrioritisation)
        .where(eq(feedbackPrioritisation.feedbackPostId, post.id))
        .limit(1)
    )[0];

    const impact =
      input.impact === undefined ? current?.impact ?? null : normalizeScaleValue(input.impact);
    const businessValue =
      input.businessValue === undefined
        ? current?.businessValue ?? null
        : normalizeScaleValue(input.businessValue);
    const effort =
      input.effort === undefined ? current?.effort ?? null : normalizeScaleValue(input.effort);

    if (
      (input.impact !== undefined && input.impact !== null && impact === null) ||
      (input.businessValue !== undefined &&
        input.businessValue !== null &&
        businessValue === null) ||
      (input.effort !== undefined && input.effort !== null && effort === null)
    ) {
      return {
        ok: false,
        status: 400,
        error: "Impact, business value and effort must be whole numbers from 1 to 5.",
      };
    }

    await db
      .insert(feedbackPrioritisation)
      .values({
        feedbackPostId: post.id,
        productId: post.productId,
        impact,
        businessValue,
        effort,
        updatedBy: input.userId,
      })
      .onConflictDoUpdate({
        target: feedbackPrioritisation.feedbackPostId,
        set: { impact, businessValue, effort, updatedBy: input.userId, updatedAt: now },
      });
  }

  await emitWebhookEvent({
    workspaceId: input.workspaceId,
    event: "request.updated",
    data: {
      request_id: post.id,
      changed: [
        "title",
        "body",
        "category",
        "status",
        "tagIds",
        "hidden",
        "customFields",
        "impact",
        "businessValue",
        "effort",
      ].filter((field) => input[field as keyof typeof input] !== undefined),
    },
  });

  return { ok: true };
}

export type CommentPage = Page<CommentRow>;

export async function listComments(input: {
  workspaceId: string;
  requestId: string;
  sort: "oldest" | "newest";
  limit: number;
  cursorValue: Date | null;
  cursorId: string | null;
}): Promise<CommentPage | null> {
  const request = await getRequest(input.workspaceId, input.requestId);
  if (!request) return null;

  const conditions: SQL[] = [eq(feedbackComments.feedbackPostId, request.row.id)];
  if (input.cursorValue && input.cursorId) {
    conditions.push(
      input.sort === "oldest"
        ? (or(
            gt(feedbackComments.createdAt, input.cursorValue),
            and(
              eq(feedbackComments.createdAt, input.cursorValue),
              gt(feedbackComments.id, input.cursorId),
            ),
          ) as SQL)
        : (or(
            lt(feedbackComments.createdAt, input.cursorValue),
            and(
              eq(feedbackComments.createdAt, input.cursorValue),
              lt(feedbackComments.id, input.cursorId),
            ),
          ) as SQL),
    );
  }

  const rows = await db
    .select({
      id: feedbackComments.id,
      feedbackPostId: feedbackComments.feedbackPostId,
      body: feedbackComments.body,
      internal: feedbackComments.internal,
      authorType: feedbackComments.authorType,
      authorName: feedbackComments.authorName,
      authorCustomerId: feedbackComments.authorCustomerId,
      authorUserId: feedbackComments.authorId,
      createdAt: feedbackComments.createdAt,
    })
    .from(feedbackComments)
    .where(
      and(
        ...conditions,
        inArray(
          feedbackComments.productId,
          db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.workspaceId, input.workspaceId)),
        ),
      ),
    )
    .orderBy(
      input.sort === "oldest" ? asc(feedbackComments.createdAt) : desc(feedbackComments.createdAt),
      input.sort === "oldest" ? asc(feedbackComments.id) : desc(feedbackComments.id),
    )
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  return { items: rows.slice(0, input.limit), hasMore };
}

export async function createComment(input: {
  workspaceId: string;
  userId: string;
  requestId: string;
  body: string;
  internal: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; status: 404; error: string }> {
  const request = await getRequest(input.workspaceId, input.requestId);
  if (!request) return { ok: false, status: 404, error: "Request not found." };

  const author = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  const authorName = author[0]?.name?.trim() || "Team member";
  const now = new Date();

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(feedbackComments)
      .values({
        productId: request.row.productId,
        feedbackPostId: request.row.id,
        authorId: input.userId,
        authorName,
        authorType: "team",
        body: input.body,
        internal: input.internal,
        createdAt: now,
      })
      .returning({ id: feedbackComments.id });

    const comment = inserted[0];
    if (!comment) throw new Error("Comment insert returned no row.");

    if (!input.internal) {
      await queueFeedbackReplyNotifications(tx, {
        productId: request.row.productId,
        postId: request.row.id,
        commentId: comment.id,
        authorName,
        body: input.body,
        eventAt: now,
        authorCustomerId: null,
      });
    }

    await tx
      .update(feedbackPosts)
      .set({ updatedAt: now })
      .where(eq(feedbackPosts.id, request.row.id));

    return comment;
  });

  await emitWebhookEvent({
    workspaceId: input.workspaceId,
    event: "comment.created",
    data: {
      request_id: request.row.id,
      comment_id: created.id,
      internal: input.internal,
    },
  });

  return { ok: true, id: created.id };
}

export async function setRequestVote(input: {
  workspaceId: string;
  requestId: string;
  customer: { id?: string | undefined; external_id?: string | undefined; email?: string | undefined; name?: string | undefined };
  voted: boolean;
}): Promise<
  | { ok: true; voted: boolean; voteCount: number }
  | { ok: false; status: 400 | 404; error: string }
> {
  const request = await getRequest(input.workspaceId, input.requestId);
  if (!request || request.row.hiddenAt) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const customer = await resolveCustomer(input.workspaceId, input.customer);
  if (!customer) {
    return { ok: false, status: 400, error: "A customer needs an `id`, `external_id` or `email`." };
  }

  if (input.voted) {
    await db
      .insert(feedbackCustomerVotes)
      .values({ feedbackPostId: request.row.id, customerId: customer.id })
      .onConflictDoNothing();
    await db
      .insert(feedbackFollowers)
      .values({
        feedbackPostId: request.row.id,
        customerId: customer.id,
        source: "api",
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(feedbackCustomerVotes)
      .where(
        and(
          eq(feedbackCustomerVotes.feedbackPostId, request.row.id),
          eq(feedbackCustomerVotes.customerId, customer.id),
        ),
      );
  }

  const [customerVotes, teamVotes, imported] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, request.row.id)),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(feedbackVotes)
      .where(eq(feedbackVotes.feedbackPostId, request.row.id)),
    db
      .select({ value: feedbackPosts.importedVoteCount })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, request.row.id))
      .limit(1),
  ]);

  return {
    ok: true,
    voted: input.voted,
    voteCount:
      (customerVotes[0]?.value ?? 0) +
      (teamVotes[0]?.value ?? 0) +
      (imported[0]?.value ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

export type ReleasePage = Page<{
  row: ReleaseRow;
  tags: string[];
  authors: { id: string; name: string }[];
  linkedRequestIds: string[];
}>;

async function hydrateReleases(workspaceId: string, rows: ReleaseRow[]) {
  if (rows.length === 0) {
    return new Map<
      string,
      { tags: string[]; authors: { id: string; name: string }[]; linkedRequestIds: string[] }
    >();
  }

  const ids = rows.map((row) => row.id);

  const [tagRows, authorRows, linkRows] = await Promise.all([
    db
      .select({ releaseId: releaseTagLinks.releaseId, name: releaseTags.name })
      .from(releaseTagLinks)
      .innerJoin(releaseTags, eq(releaseTagLinks.tagId, releaseTags.id))
      .innerJoin(releases, eq(releaseTagLinks.releaseId, releases.id))
      .innerJoin(products, eq(releases.productId, products.id))
      .where(and(eq(products.workspaceId, workspaceId), inArray(releaseTagLinks.releaseId, ids)))
      .orderBy(asc(releaseTags.name)),
    db
      .select({
        releaseId: releaseAuthors.releaseId,
        id: user.id,
        name: user.name,
        position: releaseAuthors.position,
      })
      .from(releaseAuthors)
      .innerJoin(user, eq(releaseAuthors.userId, user.id))
      .innerJoin(releases, eq(releaseAuthors.releaseId, releases.id))
      .innerJoin(products, eq(releases.productId, products.id))
      .where(and(eq(products.workspaceId, workspaceId), inArray(releaseAuthors.releaseId, ids)))
      .orderBy(asc(releaseAuthors.position)),
    db
      .select({
        releaseId: releaseFeedbackLinks.releaseId,
        feedbackPostId: releaseFeedbackLinks.feedbackPostId,
      })
      .from(releaseFeedbackLinks)
      .innerJoin(releases, eq(releaseFeedbackLinks.releaseId, releases.id))
      .innerJoin(products, eq(releases.productId, products.id))
      .where(
        and(eq(products.workspaceId, workspaceId), inArray(releaseFeedbackLinks.releaseId, ids)),
      ),
  ]);

  const map = new Map<
    string,
    { tags: string[]; authors: { id: string; name: string }[]; linkedRequestIds: string[] }
  >();
  for (const id of ids) {
    map.set(id, { tags: [], authors: [], linkedRequestIds: [] });
  }
  for (const row of tagRows) map.get(row.releaseId)?.tags.push(row.name);
  for (const row of authorRows) {
    map.get(row.releaseId)?.authors.push({ id: row.id, name: row.name });
  }
  for (const row of linkRows) {
    map.get(row.releaseId)?.linkedRequestIds.push(row.feedbackPostId);
  }
  return map;
}

export function releaseCursorValue(
  item: ReleasePage["items"][number],
  sort: ChangelogFilters["sort"],
): string {
  if (sort === "updated") return item.row.updatedAt.toISOString();
  return (item.row.publishedAt ?? item.row.createdAt).toISOString();
}

export async function listReleases(input: {
  workspaceId: string;
  filters: ChangelogFilters;
}): Promise<ReleasePage> {
  const conditions: SQL[] = [eq(products.workspaceId, input.workspaceId)];

  if (input.filters.status) conditions.push(eq(releases.status, input.filters.status));
  if (input.filters.updatedSince) {
    conditions.push(gte(releases.updatedAt, input.filters.updatedSince));
  }
  if (input.filters.query) {
    const pattern = likePattern(input.filters.query);
    conditions.push(
      or(ilike(releases.title, pattern), ilike(releases.summary, pattern)) as SQL,
    );
  }
  if (input.filters.tag) {
    const tag = input.filters.tag;
    conditions.push(
      inArray(
        releases.id,
        db
          .select({ id: releaseTagLinks.releaseId })
          .from(releaseTagLinks)
          .innerJoin(releaseTags, eq(releaseTagLinks.tagId, releaseTags.id))
          .where(
            isUuid(tag)
              ? (or(eq(releaseTags.id, tag), eq(releaseTags.slug, tag)) as SQL)
              : eq(releaseTags.slug, tag),
          ),
      ),
    );
  }

  const cursor = input.filters.cursor;
  // Drafts have no publication date; sorting on a bare nullable column would
  // put NULLs first in Postgres and make the cursor disagree with the order.
  const dateColumn: SQL<unknown> =
    input.filters.sort === "updated"
      ? sql`${releases.updatedAt}`
      : sql`coalesce(${releases.publishedAt}, ${releases.createdAt})`;
  let order: SQL[];

  if (input.filters.sort === "oldest") {
    order = [asc(dateColumn), asc(releases.id)];
    if (cursor) {
      const value = new Date(cursor.value);
      conditions.push(
        or(
          gt(dateColumn, value),
          and(eq(dateColumn, value), gt(releases.id, cursor.id)),
        ) as SQL,
      );
    }
  } else {
    order = [desc(dateColumn), desc(releases.id)];
    if (cursor) {
      const value = new Date(cursor.value);
      conditions.push(
        or(
          lt(dateColumn, value),
          and(eq(dateColumn, value), lt(releases.id, cursor.id)),
        ) as SQL,
      );
    }
  }

  const rows = await db
    .select({
      id: releases.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      title: releases.title,
      slug: releases.slug,
      summary: releases.summary,
      bodyMarkdown: releases.bodyMarkdown,
      status: releases.status,
      category: releases.category,
      version: releases.version,
      youtubeUrl: releases.youtubeUrl,
      publishedAt: releases.publishedAt,
      scheduledFor: releases.scheduledFor,
      createdAt: releases.createdAt,
      updatedAt: releases.updatedAt,
    })
    .from(releases)
    .innerJoin(products, eq(releases.productId, products.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(input.filters.limit + 1);

  const hasMore = rows.length > input.filters.limit;
  const page = (rows.slice(0, input.filters.limit) as ReleaseRow[]);
  const hydrated = await hydrateReleases(input.workspaceId, page);

  return {
    hasMore,
    items: page.map((row) => ({
      row,
      tags: hydrated.get(row.id)?.tags ?? [],
      authors: hydrated.get(row.id)?.authors ?? [],
      linkedRequestIds: hydrated.get(row.id)?.linkedRequestIds ?? [],
    })),
  };
}

export async function getRelease(
  workspaceId: string,
  releaseId: string,
): Promise<ReleasePage["items"][number] | null> {
  if (!isUuid(releaseId)) return null;
  const rows = await db
    .select({
      id: releases.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      title: releases.title,
      slug: releases.slug,
      summary: releases.summary,
      bodyMarkdown: releases.bodyMarkdown,
      status: releases.status,
      category: releases.category,
      version: releases.version,
      youtubeUrl: releases.youtubeUrl,
      publishedAt: releases.publishedAt,
      scheduledFor: releases.scheduledFor,
      createdAt: releases.createdAt,
      updatedAt: releases.updatedAt,
    })
    .from(releases)
    .innerJoin(products, eq(releases.productId, products.id))
    .where(and(eq(releases.id, releaseId), eq(products.workspaceId, workspaceId)))
    .limit(1);

  const row = rows[0] as ReleaseRow | undefined;
  if (!row) return null;
  const hydrated = await hydrateReleases(workspaceId, [row]);
  return {
    row,
    tags: hydrated.get(row.id)?.tags ?? [],
    authors: hydrated.get(row.id)?.authors ?? [],
    linkedRequestIds: hydrated.get(row.id)?.linkedRequestIds ?? [],
  };
}

export async function createChangelog(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  draft: ReleaseDraftCreateInput;
}) {
  const result = await createReleaseDraft(
    {
      workspaceId: input.workspaceId,
      productId: input.productId,
      userId: input.userId,
    },
    input.draft,
  );

  if (result.ok) {
    await emitWebhookEvent({
      workspaceId: input.workspaceId,
      event: "changelog.created",
      data: { release_id: result.releaseId, status: "draft" },
    });
  }

  return result;
}

export async function updateChangelog(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  releaseId: string;
  draft: ReleaseDraftUpdateInput;
}) {
  return updateReleaseDraft(
    {
      workspaceId: input.workspaceId,
      productId: input.productId,
      userId: input.userId,
    },
    input.releaseId,
    input.draft,
  );
}

// ---------------------------------------------------------------------------
// Members and companies
// ---------------------------------------------------------------------------

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(user.name));
}

export async function listCompanies(input: {
  workspaceId: string;
  query: string;
}): Promise<CompanyRow[]> {
  const conditions: SQL[] = [eq(customerCompanies.workspaceId, input.workspaceId)];
  if (input.query) {
    const pattern = likePattern(input.query);
    conditions.push(
      or(
        ilike(customerCompanies.name, pattern),
        ilike(customerCompanies.domain, pattern),
        ilike(customerCompanies.externalId, pattern),
      ) as SQL,
    );
  }

  const rows = await db
    .select({
      id: customerCompanies.id,
      name: customerCompanies.name,
      externalId: customerCompanies.externalId,
      domain: customerCompanies.domain,
      traits: customerCompanies.traits,
      createdAt: customerCompanies.createdAt,
      updatedAt: customerCompanies.updatedAt,
      customerCount: sql<number>`(
        select count(*)::int from ${customerCompanyMemberships}
        where ${customerCompanyMemberships.companyId} = ${customerCompanies.id}
      )`,
    })
    .from(customerCompanies)
    .where(and(...conditions))
    .orderBy(asc(customerCompanies.name));

  return rows as CompanyRow[];
}

export async function getCompany(
  workspaceId: string,
  companyId: string,
): Promise<(CompanyRow & { customers: { id: string; name: string | null; email: string | null; role: string | null }[] }) | null> {
  if (!isUuid(companyId)) return null;

  const rows = await db
    .select({
      id: customerCompanies.id,
      name: customerCompanies.name,
      externalId: customerCompanies.externalId,
      domain: customerCompanies.domain,
      traits: customerCompanies.traits,
      createdAt: customerCompanies.createdAt,
      updatedAt: customerCompanies.updatedAt,
      customerCount: sql<number>`(
        select count(*)::int from ${customerCompanyMemberships}
        where ${customerCompanyMemberships.companyId} = ${customerCompanies.id}
      )`,
    })
    .from(customerCompanies)
    .where(
      and(
        eq(customerCompanies.id, companyId),
        eq(customerCompanies.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const row = rows[0] as CompanyRow | undefined;
  if (!row) return null;

  const members = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      role: customerCompanyMemberships.role,
    })
    .from(customerCompanyMemberships)
    .innerJoin(customers, eq(customerCompanyMemberships.customerId, customers.id))
    .where(eq(customerCompanyMemberships.companyId, row.id))
    .orderBy(asc(customers.name));

  return { ...row, customers: members };
}

export async function createCompany(input: {
  workspaceId: string;
  name: string;
  externalId: string | null;
  domain: string | null;
  traits: Record<string, unknown>;
}): Promise<string> {
  const inserted = await db
    .insert(customerCompanies)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      externalId: input.externalId,
      domain: input.domain,
      domainNormalized: input.domain ? input.domain.toLowerCase() : null,
      traits: input.traits,
    })
    .returning({ id: customerCompanies.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("Company insert returned no row.");
  return id;
}

export async function updateCompany(
  workspaceId: string,
  companyId: string,
  patch: {
    name?: string;
    externalId?: string | null;
    domain?: string | null;
    traits?: Record<string, unknown>;
  },
): Promise<boolean> {
  const existing = await getCompany(workspaceId, companyId);
  if (!existing) return false;

  await db
    .update(customerCompanies)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.externalId === undefined ? {} : { externalId: patch.externalId }),
      ...(patch.domain === undefined
        ? {}
        : {
            domain: patch.domain,
            domainNormalized: patch.domain ? patch.domain.toLowerCase() : null,
          }),
      ...(patch.traits === undefined ? {} : { traits: patch.traits }),
      updatedAt: new Date(),
    })
    .where(eq(customerCompanies.id, companyId));

  return true;
}

export async function addCompanyCustomer(input: {
  workspaceId: string;
  companyId: string;
  customer: { id?: string | undefined; external_id?: string | undefined; email?: string | undefined; name?: string | undefined };
  role: string | null;
}): Promise<{ ok: true } | { ok: false; status: 400 | 404; error: string }> {
  const company = await getCompany(input.workspaceId, input.companyId);
  if (!company) return { ok: false, status: 404, error: "Company not found." };

  const customer = await resolveCustomer(input.workspaceId, input.customer);
  if (!customer) {
    return { ok: false, status: 400, error: "A customer needs an `id`, `external_id` or `email`." };
  }

  await db
    .insert(customerCompanyMemberships)
    .values({
      workspaceId: input.workspaceId,
      companyId: company.id,
      customerId: customer.id,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [customerCompanyMemberships.companyId, customerCompanyMemberships.customerId],
      set: { role: input.role },
    });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------

function conversationViewPredicate(view: ConversationFilters["inboxState"], now: Date): SQL {
  switch (view) {
    case "queue":
      return or(
        inArray(conversations.status, ["queue", "open"]),
        and(eq(conversations.status, "snoozed"), lte(conversations.snoozedUntil, now)),
      ) as SQL;
    case "open":
      return eq(conversations.status, "open");
    case "all":
      return inArray(conversations.status, ["queue", "open", "snoozed", "resolved"]);
    case "snoozed":
      return and(
        eq(conversations.status, "snoozed"),
        gte(conversations.snoozedUntil, now),
      ) as SQL;
    case "resolved":
      return eq(conversations.status, "resolved");
    case "spam":
      return eq(conversations.status, "spam");
    case "archived":
    default:
      return eq(conversations.status, "archived");
  }
}

export async function listConversations(input: {
  workspaceId: string;
  userId: string | null;
  filters: ConversationFilters;
}): Promise<Page<ConversationRow>> {
  const now = new Date();
  const conditions: SQL[] = [
    eq(products.workspaceId, input.workspaceId),
    conversationViewPredicate(input.filters.inboxState, now),
  ];

  if (input.filters.assignee) {
    if (input.filters.assignee === "unassigned") {
      conditions.push(isNull(conversations.assigneeId));
    } else if (input.filters.assignee === "me" && input.userId) {
      conditions.push(eq(conversations.assigneeId, input.userId));
    } else if (isUuid(input.filters.assignee)) {
      conditions.push(eq(conversations.assigneeId, input.filters.assignee));
    } else {
      conditions.push(sql`false`);
    }
  }

  if (input.filters.updatedSince) {
    conditions.push(gte(conversations.updatedAt, input.filters.updatedSince));
  }

  if (input.filters.query) {
    const pattern = likePattern(input.filters.query);
    conditions.push(
      or(
        ilike(conversations.subject, pattern),
        ilike(conversations.lastMessagePreview, pattern),
        ilike(customers.name, pattern),
        ilike(customers.email, pattern),
      ) as SQL,
    );
  }

  const cursor = input.filters.cursor;
  const dateColumn =
    input.filters.sort === "updated" ? conversations.updatedAt : conversations.lastMessageAt;
  let order: SQL[];

  if (input.filters.sort === "oldest") {
    order = [asc(dateColumn), asc(conversations.id)];
    if (cursor) {
      const value = new Date(cursor.value);
      conditions.push(
        or(
          gt(dateColumn, value),
          and(eq(dateColumn, value), gt(conversations.id, cursor.id)),
        ) as SQL,
      );
    }
  } else {
    order = [desc(dateColumn), desc(conversations.id)];
    if (cursor) {
      const value = new Date(cursor.value);
      conditions.push(
        or(
          lt(dateColumn, value),
          and(eq(dateColumn, value), lt(conversations.id, cursor.id)),
        ) as SQL,
      );
    }
  }

  const rows = await db
    .select({
      id: conversations.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      subject: conversations.subject,
      status: conversations.status,
      customerId: conversations.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      assigneeId: conversations.assigneeId,
      assigneeName: user.name,
      unreadForTeam: conversations.unreadForTeam,
      lastMessagePreview: conversations.lastMessagePreview,
      lastMessageAt: conversations.lastMessageAt,
      snoozedUntil: conversations.snoozedUntil,
      resolvedAt: conversations.resolvedAt,
      sourceUrl: conversations.sourceUrl,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(products, eq(conversations.productId, products.id))
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(user, eq(conversations.assigneeId, user.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(input.filters.limit + 1);

  const hasMore = rows.length > input.filters.limit;
  return { items: rows.slice(0, input.filters.limit) as ConversationRow[], hasMore };
}

export function conversationCursorValue(
  row: ConversationRow,
  sort: ConversationFilters["sort"],
): string {
  return sort === "updated" ? row.updatedAt.toISOString() : row.lastMessageAt.toISOString();
}

export async function getConversation(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  if (!isUuid(conversationId)) return null;
  const rows = await db
    .select({
      id: conversations.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      subject: conversations.subject,
      status: conversations.status,
      customerId: conversations.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      assigneeId: conversations.assigneeId,
      assigneeName: user.name,
      unreadForTeam: conversations.unreadForTeam,
      lastMessagePreview: conversations.lastMessagePreview,
      lastMessageAt: conversations.lastMessageAt,
      snoozedUntil: conversations.snoozedUntil,
      resolvedAt: conversations.resolvedAt,
      sourceUrl: conversations.sourceUrl,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(products, eq(conversations.productId, products.id))
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(user, eq(conversations.assigneeId, user.id))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(products.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return (rows[0] as ConversationRow | undefined) ?? null;
}

export function messageCursorValue(row: MessageRow): string {
  return row.createdAt.toISOString();
}

export async function listMessages(input: {
  workspaceId: string;
  conversationId: string;
  sort: "oldest" | "newest";
  limit: number;
  cursorValue: Date | null;
  cursorId: string | null;
}): Promise<Page<MessageRow> | null> {
  const conversation = await getConversation(input.workspaceId, input.conversationId);
  if (!conversation) return null;

  const conditions: SQL[] = [
    eq(conversationMessages.conversationId, conversation.id),
    eq(conversationMessages.productId, conversation.productId),
  ];

  if (input.cursorValue && input.cursorId) {
    conditions.push(
      input.sort === "oldest"
        ? (or(
            gt(conversationMessages.createdAt, input.cursorValue),
            and(
              eq(conversationMessages.createdAt, input.cursorValue),
              gt(conversationMessages.id, input.cursorId),
            ),
          ) as SQL)
        : (or(
            lt(conversationMessages.createdAt, input.cursorValue),
            and(
              eq(conversationMessages.createdAt, input.cursorValue),
              lt(conversationMessages.id, input.cursorId),
            ),
          ) as SQL),
    );
  }

  const rows = await db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      kind: conversationMessages.kind,
      authorType: conversationMessages.authorType,
      authorUserId: conversationMessages.authorUserId,
      authorName: user.name,
      body: conversationMessages.body,
      channel: conversationMessages.channel,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .leftJoin(user, eq(conversationMessages.authorUserId, user.id))
    .where(and(...conditions))
    .orderBy(
      input.sort === "oldest"
        ? asc(conversationMessages.createdAt)
        : desc(conversationMessages.createdAt),
      input.sort === "oldest"
        ? asc(conversationMessages.id)
        : desc(conversationMessages.id),
    )
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  return { items: rows.slice(0, input.limit) as MessageRow[], hasMore };
}

export async function appendMessage(input: {
  workspaceId: string;
  conversationId: string;
  userId: string;
  body: string;
  kind: "message" | "note";
}): Promise<
  | { ok: true; messageId: string | null; status: string }
  | { ok: false; status: 404 | 400; error: string }
> {
  const conversation = await getConversation(input.workspaceId, input.conversationId);
  if (!conversation) return { ok: false, status: 404, error: "Conversation not found." };

  const result = await appendTeamMessage({
    productId: conversation.productId,
    conversationId: conversation.id,
    userId: input.userId,
    body: input.body,
    kind: input.kind,
  });

  if (!result.ok) return { ok: false, status: 400, error: result.error };

  await emitWebhookEvent({
    workspaceId: input.workspaceId,
    event: "message.created",
    data: {
      conversation_id: conversation.id,
      message_id: result.data.messageId,
      kind: input.kind,
    },
  });

  return { ok: true, ...result.data };
}

export async function updateConversation(input: {
  workspaceId: string;
  conversationId: string;
  status?: "open" | "resolved" | "spam" | "archived" | undefined;
  assigneeId?: string | null | undefined;
}): Promise<{ ok: true } | { ok: false; status: 404 | 400; error: string }> {
  const conversation = await getConversation(input.workspaceId, input.conversationId);
  if (!conversation) return { ok: false, status: 404, error: "Conversation not found." };

  if (input.status) {
    const result = await setConversationStatus({
      productId: conversation.productId,
      conversationId: conversation.id,
      status: input.status,
    });
    if (!result.ok) return { ok: false, status: 400, error: result.error };
  }

  if (input.assigneeId !== undefined) {
    const result = await assignConversation({
      productId: conversation.productId,
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      assigneeId: input.assigneeId,
    });
    if (!result.ok) return { ok: false, status: 400, error: result.error };
  }

  await emitWebhookEvent({
    workspaceId: input.workspaceId,
    event: "conversation.updated",
    data: {
      conversation_id: conversation.id,
      status: input.status ?? conversation.status,
      assignee_id: input.assigneeId ?? conversation.assigneeId ?? null,
    },
  });

  return { ok: true };
}

