import type { ApiScope } from "@/db/schema";

/**
 * Public JSON shapes for `/api/v1`.
 *
 * One function per resource keeps the field list in one place and makes the
 * contract reviewable. Nothing here echoes a token hash, a session secret, an
 * internal moderation reason or another tenant's id.
 */

export type BoardRow = {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  visibility: "public" | "private";
  guestPosting: boolean;
  settings: {
    moderation: {
      requireApproval: "none" | "first_time" | "all";
      comments: "open" | "moderated" | "closed";
      blockSensitiveInfo: boolean;
    };
  };
  position: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  requestCount?: number;
};

export type CustomFieldRow = {
  id: string;
  productId: string;
  productSlug: string;
  key: string;
  label: string;
  description: string | null;
  type: "text" | "number" | "select" | "date";
  options: string[];
  required: boolean;
  position: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TagRow = {
  id: string;
  productId: string;
  boardId: string;
  name: string;
  color: string | null;
  position: number;
  createdAt: Date;
};

export type RequestRow = {
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
  voteCount: number;
  commentCount: number;
  archivedAt: Date | null;
  hiddenAt: Date | null;
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentRow = {
  id: string;
  feedbackPostId: string;
  body: string;
  internal: boolean;
  authorType: "customer" | "team";
  authorName: string;
  authorCustomerId: string | null;
  authorUserId: string | null;
  createdAt: Date;
};

export type ReleaseRow = {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  title: string;
  slug: string;
  summary: string | null;
  bodyMarkdown: string | null;
  status: string;
  category: string;
  version: string | null;
  youtubeUrl: string | null;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

export type CompanyRow = {
  id: string;
  name: string;
  externalId: string | null;
  domain: string | null;
  traits: Record<string, unknown>;
  customerCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationRow = {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  subject: string;
  status: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  unreadForTeam: number;
  lastMessagePreview: string;
  lastMessageAt: Date;
  snoozedUntil: Date | null;
  resolvedAt: Date | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  kind: "message" | "note";
  authorType: string;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  channel: string;
  createdAt: Date;
};

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function serializeToken(token: {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt?: Date | null;
  rotatedFromId?: string | null;
  createdAt: Date;
  lastUsedIpPrefix?: string | null;
  lastUsedUserAgent?: string | null;
}) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    status:
      token.expiresAt && token.expiresAt.getTime() <= Date.now()
        ? "expired"
        : token.revokedAt === null
          ? "active"
          : token.revokedAt.getTime() > Date.now()
            ? "retiring"
            : "revoked",
    last_used_at: iso(token.lastUsedAt),
    /** Coarse last-seen metadata: a network prefix and a short user-agent label. */
    last_used_ip_prefix: token.lastUsedIpPrefix ?? null,
    last_used_user_agent: token.lastUsedUserAgent ?? null,
    revoked_at: iso(token.revokedAt),
    expires_at: iso(token.expiresAt ?? null),
    rotated_from_id: token.rotatedFromId ?? null,
    created_at: token.createdAt.toISOString(),
  };
}

export function serializeBoard(row: BoardRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    color: row.color,
    visibility: row.visibility,
    guest_posting: row.guestPosting,
    moderation: row.settings.moderation,
    position: row.position,
    archived_at: iso(row.archivedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    product: {
      id: row.productId,
      slug: row.productSlug,
      name: row.productName,
    },
    request_count: row.requestCount ?? 0,
  };
}

export function serializeCustomField(row: CustomFieldRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    options: row.options,
    required: row.required,
    position: row.position,
    archived: row.archivedAt !== null,
    archived_at: iso(row.archivedAt),
    product: { id: row.productId, slug: row.productSlug },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function serializeTag(row: TagRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    board_id: row.boardId,
    product_id: row.productId,
    created_at: row.createdAt.toISOString(),
  };
}

export function serializeRequest(
  row: RequestRow,
  tags: { id: string; name: string; color: string | null }[],
  extras: {
    customFields: Record<string, string | number>;
    signals: {
      impact: number | null;
      businessValue: number | null;
      effort: number | null;
      valuePerEffort: number | null;
      requesterCount: number;
      knownArr: number | null;
      knownOpenDealValue: number | null;
      requesterWeight: number;
      priorityScore: number | null;
    };
  },
) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    category: row.category,
    source: row.source,
    board: row.boardId
      ? { id: row.boardId, slug: row.boardSlug, name: row.boardName }
      : null,
    product: { id: row.productId, slug: row.productSlug, name: row.productName },
    author: row.authorCustomerId
      ? {
          id: row.authorCustomerId,
          name: row.authorCustomerName,
          email: row.authorCustomerEmail,
          external_id: row.authorCustomerExternalId,
        }
      : null,
    created_by: row.authorId,
    author_label: row.authorLabel,
    author_email: row.authorEmail,
    author_company: row.authorCompany,
    vote_count: row.voteCount,
    comment_count: row.commentCount,
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    })),
    custom_fields: extras.customFields,
    signals: {
      impact: extras.signals.impact,
      business_value: extras.signals.businessValue,
      effort: extras.signals.effort,
      value_per_effort: extras.signals.valuePerEffort,
      requester_count: extras.signals.requesterCount,
      requester_weight: extras.signals.requesterWeight,
      known_arr: extras.signals.knownArr,
      known_open_deal_value: extras.signals.knownOpenDealValue,
      priority_score: extras.signals.priorityScore,
    },
    archived: row.archivedAt !== null,
    hidden: row.hiddenAt !== null,
    merged_into_id: row.mergedIntoId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function serializeComment(row: CommentRow) {
  return {
    id: row.id,
    request_id: row.feedbackPostId,
    body: row.body,
    internal: row.internal,
    author_type: row.authorType,
    author: {
      name: row.authorName,
      customer_id: row.authorCustomerId,
      user_id: row.authorUserId,
    },
    created_at: row.createdAt.toISOString(),
  };
}

export function serializeRelease(
  row: ReleaseRow,
  tags: string[],
  authors: { id: string; name: string }[],
  linkedRequestIds: string[],
) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.bodyMarkdown,
    status: row.status,
    category: row.category,
    version: row.version,
    youtube_url: row.youtubeUrl,
    published_at: iso(row.publishedAt),
    scheduled_for: iso(row.scheduledFor),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    product: { id: row.productId, slug: row.productSlug, name: row.productName },
    tags,
    authors,
    linked_request_ids: linkedRequestIds,
  };
}

export function serializeMember(row: MemberRow) {
  return {
    user_id: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    created_at: row.createdAt.toISOString(),
  };
}

export function serializeCompany(row: CompanyRow) {
  return {
    id: row.id,
    name: row.name,
    external_id: row.externalId,
    domain: row.domain,
    traits: row.traits,
    customer_count: row.customerCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function serializeConversation(row: ConversationRow) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    product: { id: row.productId, slug: row.productSlug, name: row.productName },
    customer: {
      id: row.customerId,
      name: row.customerName,
      email: row.customerEmail,
    },
    assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName } : null,
    unread_for_team: row.unreadForTeam,
    last_message_preview: row.lastMessagePreview,
    last_message_at: row.lastMessageAt.toISOString(),
    snoozed_until: iso(row.snoozedUntil),
    resolved_at: iso(row.resolvedAt),
    source_url: row.sourceUrl,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function serializeMessage(row: MessageRow) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    kind: row.kind,
    author_type: row.authorType,
    author: row.authorName,
    body: row.body,
    channel: row.channel,
    created_at: row.createdAt.toISOString(),
  };
}
