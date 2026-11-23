/**
 * Factories for integration tests.
 *
 * Every factory writes through the application's normal `db` handle, so rows
 * are created inside the current test transaction and rolled back with it.
 * Each call generates a unique slug, email and id; tests never depend on
 * pre-existing rows or a seed script.
 */

import { db } from "@/db";
import {
  boardTags,
  boards,
  conversationMessages,
  conversations,
  customers,
  feedbackComments,
  feedbackPosts,
  feedbackTagLinks,
  feedbackVotes,
  moderationReviews,
  products,
  releaseAuthors,
  releaseFeedbackLinks,
  releaseTagLinks,
  releaseTags,
  releases,
  user as authUser,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import type { Board, BoardSettings } from "@/db/schema/boards";
import { eq, sql } from "drizzle-orm";

import type {
  Conversation,
  ConversationMessage,
  Customer,
  FeedbackComment,
  FeedbackPost,
  ModerationReview,
} from "@/db/schema";
import type { Product, Workspace, WorkspaceMember } from "@/db/schema/workspaces";
import type { Release } from "@/db/schema/releases";
import type { User } from "@/db/schema/auth";
import { normalizeEmail } from "@/lib/email";
import { normalizeReleaseTags } from "@/features/releases/tags";

let sequence = 0;

/** Unique, URL-safe label for slugs, emails and external ids. */
export function uniqueLabel(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export async function createWorkspace(
  input: { name?: string | undefined; slug?: string | undefined; plan?: "free" | "pro" | undefined } = {},
): Promise<Workspace> {
  const slug = input.slug ?? uniqueLabel("workspace");
  const rows = await db
    .insert(workspaces)
    .values({
      name: input.name ?? `Workspace ${slug}`,
      slug,
      plan: input.plan ?? "free",
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Workspace insert returned no row.");
  return row;
}

export async function createProduct(
  workspaceId: string,
  input: {
    name?: string;
    slug?: string;
    description?: string | null;
    publicFeedbackEnabled?: boolean;
    publicRoadmapEnabled?: boolean;
    publicChangelogEnabled?: boolean;
  } = {},
): Promise<Product> {
  const slug = input.slug ?? uniqueLabel("product");
  const rows = await db
    .insert(products)
    .values({
      workspaceId,
      name: input.name ?? `Product ${slug}`,
      slug,
      description: input.description ?? null,
      publicFeedbackEnabled: input.publicFeedbackEnabled ?? true,
      publicRoadmapEnabled: input.publicRoadmapEnabled ?? false,
      publicChangelogEnabled: input.publicChangelogEnabled ?? false,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Product insert returned no row.");
  return row;
}

export async function createRelease(input: {
  productId: string;
  title?: string;
  slug?: string;
  summary?: string;
  body?: string;
  translations?: Release["translations"];
  status?: Release["status"];
  category?: Release["category"];
  publishedAt?: Date | null;
  scheduledFor?: Date | null;
  youtubeUrl?: string | null;
  channelPublicChangelog?: boolean;
  authorIds?: string[];
  tagNames?: string[];
}): Promise<Release> {
  const slug = input.slug ?? uniqueLabel("release");
  const rows = await db
    .insert(releases)
    .values({
      productId: input.productId,
      title: input.title ?? `Release ${slug}`,
      slug,
      summary: input.summary ?? "A small but useful update.",
      bodyMarkdown: input.body ?? "### What changed\n\nA small but useful update.",
      translations: input.translations ?? {},
      status: input.status ?? "published",
      category: input.category ?? "feature",
      publishedAt:
        input.status === "draft" || input.status === "scheduled"
          ? null
          : (input.publishedAt ?? new Date()),
      scheduledFor: input.status === "scheduled" ? (input.scheduledFor ?? null) : null,
      youtubeUrl: input.youtubeUrl ?? null,
      channelPublicChangelog: input.channelPublicChangelog ?? true,
      authorId: input.authorIds?.[0] ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Release insert returned no row.");

  if (input.authorIds && input.authorIds.length > 0) {
    await db
      .insert(releaseAuthors)
      .values(
        input.authorIds.map((userId, position) => ({
          releaseId: row.id,
          productId: input.productId,
          userId,
          position,
        })),
      )
      .onConflictDoNothing();
  }

  const tags = normalizeReleaseTags(input.tagNames ?? []);
  if (tags.length > 0) {
    await db
      .insert(releaseTags)
      .values(tags.map((tag) => ({ productId: input.productId, name: tag.name, slug: tag.slug })))
      .onConflictDoNothing();
    const stored = await db
      .select({ id: releaseTags.id, slug: releaseTags.slug })
      .from(releaseTags)
      .where(eq(releaseTags.productId, input.productId));
    const idBySlug = new Map(stored.map((tag) => [tag.slug, tag.id]));
    await db
      .insert(releaseTagLinks)
      .values(
        tags.flatMap((tag) => {
          const tagId = idBySlug.get(tag.slug);
          return tagId ? [{ releaseId: row.id, tagId, productId: input.productId }] : [];
        }),
      )
      .onConflictDoNothing();
  }

  return row;
}

export async function createReleaseFeedbackLink(input: {
  productId: string;
  releaseId: string;
  feedbackPostId: string;
}): Promise<void> {
  await db.insert(releaseFeedbackLinks).values(input).onConflictDoNothing();
}

export async function createBoard(
  productId: string,
  input: {
    name?: string;
    slug?: string;
    visibility?: Board["visibility"];
    guestPosting?: boolean;
    archivedAt?: Date | null;
    position?: number;
    settings?: BoardSettings;
  } = {},
): Promise<Board> {
  const slug = input.slug ?? uniqueLabel("board");
  const rows = await db
    .insert(boards)
    .values({
      productId,
      name: input.name ?? `Board ${slug}`,
      slug,
      visibility: input.visibility ?? "public",
      guestPosting: input.guestPosting ?? false,
      archivedAt: input.archivedAt ?? null,
      position: input.position ?? 0,
      ...(input.settings ? { settings: input.settings } : {}),
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Board insert returned no row.");
  return row;
}

export async function createUser(
  input: { name?: string; email?: string } = {},
): Promise<User> {
  const id = `usr_${uniqueLabel("user").replace(/-/g, "_")}`;
  const email = input.email ?? `${uniqueLabel("person")}@example.test`;

  const rows = await db
    .insert(authUser)
    .values({
      id,
      name: input.name ?? "Test Person",
      email,
      emailVerified: true,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("User insert returned no row.");
  return row;
}

export async function createMember(
  workspaceId: string,
  input: {
    user?: User;
    role?: WorkspaceMember["role"];
  } = {},
): Promise<{ member: WorkspaceMember; user: User }> {
  const user = input.user ?? (await createUser());

  const rows = await db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId: user.id,
      role: input.role ?? "editor",
    })
    .returning();

  const member = rows[0];
  if (!member) throw new Error("Membership insert returned no row.");
  return { member, user };
}

export async function createConversation(input: {
  productId: string;
  workspaceId: string;
  customerId: string;
  subject?: string | undefined;
  status?: Conversation["status"] | undefined;
  assigneeId?: string | null | undefined;
  snoozedUntil?: Date | null | undefined;
  unreadForTeam?: number | undefined;
  lastMessagePreview?: string | undefined;
  lastMessageAt?: Date | undefined;
}): Promise<Conversation> {
  const now = input.lastMessageAt ?? new Date();
  const rows = await db
    .insert(conversations)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      customerId: input.customerId,
      subject: input.subject ?? `Conversation ${uniqueLabel("thread")}`,
      status: input.status ?? "queue",
      assigneeId: input.assigneeId ?? null,
      snoozedUntil: input.snoozedUntil ?? null,
      unreadForTeam: input.unreadForTeam ?? 0,
      lastMessagePreview: input.lastMessagePreview ?? "",
      lastMessageAt: now,
      lastCustomerMessageAt: input.unreadForTeam ? now : null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Conversation insert returned no row.");
  return row;
}

export async function createConversationMessage(input: {
  conversation: Conversation;
  authorType: "customer" | "team" | "system";
  authorUserId?: string | null;
  authorCustomerId?: string | null;
  kind?: "message" | "note";
  body?: string;
  createdAt?: Date;
}): Promise<ConversationMessage> {
  const createdAt = input.createdAt ?? new Date();
  const body = input.body ?? "A message.";
  const rows = await db
    .insert(conversationMessages)
    .values({
      conversationId: input.conversation.id,
      productId: input.conversation.productId,
      authorType: input.authorType,
      authorUserId: input.authorUserId ?? null,
      authorCustomerId:
        input.authorCustomerId ??
        (input.authorType === "customer" ? input.conversation.customerId : null),
      kind: input.kind ?? "message",
      body,
      createdAt,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Conversation message insert returned no row.");

  await db
    .update(conversations)
    .set({
      lastMessagePreview: body.slice(0, 160),
      lastMessageAt: createdAt,
      unreadForTeam:
        input.authorType === "customer" && (input.kind ?? "message") === "message"
          ? sql`${conversations.unreadForTeam} + 1`
          : input.conversation.unreadForTeam,
    })
    .where(eq(conversations.id, input.conversation.id));

  return row;
}

export async function createCustomer(
  workspaceId: string,
  input: {
    name?: string;
    email?: string | null;
    verifiedAt?: Date | null;
    bannedAt?: Date | null;
  } = {},
): Promise<Customer> {
  const email = input.email ?? null;
  const rows = await db
    .insert(customers)
    .values({
      workspaceId,
      name: input.name ?? "Test Customer",
      email,
      emailNormalized: email === null ? null : normalizeEmail(email),
      verifiedAt: input.verifiedAt ?? null,
      bannedAt: input.bannedAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Customer insert returned no row.");
  return row;
}

export async function createFeedbackPost(input: {
  productId: string;
  boardId?: string | null;
  title?: string;
  body?: string;
  status?: FeedbackPost["status"];
  category?: FeedbackPost["category"];
  authorLabel?: string | null;
  authorEmail?: string | null;
  authorCustomerId?: string | null;
  archivedAt?: Date | null;
  hiddenAt?: Date | null;
  mergedIntoId?: string | null;
  createdAt?: Date;
}): Promise<FeedbackPost> {
  const rows = await db
    .insert(feedbackPosts)
    .values({
      productId: input.productId,
      boardId: input.boardId ?? null,
      title: input.title ?? "A test request",
      body: input.body ?? "Please build this.",
      status: input.status ?? "open",
      category: input.category ?? "feature_request",
      authorLabel: input.authorLabel ?? "Fixture author",
      authorEmail: input.authorEmail ?? null,
      authorCustomerId: input.authorCustomerId ?? null,
      archivedAt: input.archivedAt ?? null,
      hiddenAt: input.hiddenAt ?? null,
      mergedIntoId: input.mergedIntoId ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Feedback insert returned no row.");
  return row;
}

export async function createFeedbackVote(input: {
  feedbackPostId: string;
  voterId: string;
  createdAt?: Date;
}): Promise<void> {
  await db.insert(feedbackVotes).values(input);
}

export async function createBoardTag(
  boardId: string,
  productId: string,
  input: { name: string; color?: string | null; position?: number },
): Promise<void> {
  await db.insert(boardTags).values({
    boardId,
    productId,
    name: input.name,
    color: input.color ?? null,
    position: input.position ?? 0,
  });
}

export async function linkTagToPost(input: {
  productId: string;
  feedbackPostId: string;
  tagName: string;
}): Promise<void> {
  const tags = await db
    .select({ id: boardTags.id })
    .from(boardTags)
    .where(eq(boardTags.name, input.tagName))
    .limit(1);
  const tag = tags[0];
  if (!tag) throw new Error(`Tag "${input.tagName}" was not created in this test.`);

  await db.insert(feedbackTagLinks).values({
    productId: input.productId,
    feedbackPostId: input.feedbackPostId,
    tagId: tag.id,
  });
}

export async function createModerationReview(input: {
  productId: string;
  contentType: "feedback_post" | "feedback_comment";
  contentId: string;
  status: "pending" | "approved" | "rejected";
  reasons?: string[];
}): Promise<ModerationReview> {
  const rows = await db
    .insert(moderationReviews)
    .values({
      productId: input.productId,
      contentType: input.contentType,
      contentId: input.contentId,
      status: input.status,
      reasons: input.reasons ?? [],
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Moderation review insert returned no row.");
  return row;
}

export async function createFeedbackComment(input: {
  productId: string;
  feedbackPostId: string;
  body?: string;
  internal?: boolean;
  authorName?: string;
  authorType?: FeedbackComment["authorType"];
}): Promise<FeedbackComment> {
  const rows = await db
    .insert(feedbackComments)
    .values({
      productId: input.productId,
      feedbackPostId: input.feedbackPostId,
      body: input.body ?? "A comment.",
      internal: input.internal ?? false,
      authorName: input.authorName ?? "Test Team",
      authorType: input.authorType ?? "team",
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Comment insert returned no row.");
  return row;
}
