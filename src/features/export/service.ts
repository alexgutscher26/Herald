import "server-only";

import { eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import {
  boardTags,
  boards,
  customers,
  feedbackAttachments,
  feedbackComments,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackImports,
  feedbackMerges,
  feedbackPosts,
  feedbackReactions,
  feedbackTagLinks,
  feedbackVotes,
  products,
  workspaces,
} from "@/db/schema";

import { toCsv } from "@/features/import/csv";

/**
 * Full feedback export.
 *
 * This is the workspace's own data leaving the product, so it is deliberately
 * complete: private and archived boards, hidden and archived requests, internal
 * comments, every vote and follower, and merge provenance. The route that
 * serves it requires `settings:manage`.
 */

export type ExportRequest = {
  id: string;
  board: { id: string | null; name: string | null; slug: string | null };
  title: string;
  body: string;
  status: string;
  category: string;
  source: string;
  author: {
    customerId: string | null;
    name: string | null;
    label: string | null;
    email: string | null;
    company: string | null;
  };
  votes: {
    team: number;
    customer: number;
    imported: number;
    total: number;
  };
  tags: string[];
  comments: {
    id: string;
    authorName: string;
    authorType: string;
    body: string;
    internal: boolean;
    createdAt: string;
  }[];
  followers: { customerId: string; name: string | null; email: string | null; source: string }[];
  reactions: { kind: string; customerId: string; name: string | null; email: string | null }[];
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    storageKey: string;
    target: "request" | "comment";
  }[];
  /** `null` unless this request was merged into another one. */
  mergedInto: { id: string; title: string; status: string } | null;
  import: { id: string; fileName: string; rowNumber: number | null } | null;
  hidden: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExportBundle = {
  exportedAt: string;
  workspace: { id: string; name: string; slug: string; plan: string };
  product: { id: string; name: string; slug: string };
  boards: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    visibility: string;
    guestPosting: boolean;
    archived: boolean;
    createdAt: string;
  }[];
  tags: { id: string; boardId: string; name: string; color: string | null }[];
  requests: ExportRequest[];
  merges: {
    id: string;
    sourcePostId: string;
    targetPostId: string;
    sourceStatus: string;
    undone: boolean;
    createdAt: string;
  }[];
};

export async function buildExportBundle(input: {
  workspaceId: string;
  productId: string;
}): Promise<ExportBundle | null> {
  const productRows = await db
    .select({
      product: { id: products.id, name: products.name, slug: products.slug },
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
      },
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(eq(products.id, input.productId))
    .limit(1);

  const context = productRows[0];
  if (!context || context.workspace.id !== input.workspaceId) return null;

  const [boardRows, tagRows, postRows, mergeRows, importRows] = await Promise.all([
    db.select().from(boards).where(eq(boards.productId, input.productId)),
    db.select().from(boardTags).where(eq(boardTags.productId, input.productId)),
    db.select().from(feedbackPosts).where(eq(feedbackPosts.productId, input.productId)),
    db.select().from(feedbackMerges).where(eq(feedbackMerges.productId, input.productId)),
    db.select().from(feedbackImports).where(eq(feedbackImports.productId, input.productId)),
  ]);

  const exportedBoards = boardRows.map(exportBoard);
  const postIds = postRows.map((post) => post.id);
  const commentIds = (
    await db
      .select({ id: feedbackComments.id })
      .from(feedbackComments)
      .where(eq(feedbackComments.productId, input.productId))
  ).map((row) => row.id);
  if (postIds.length === 0) {
    return {
      exportedAt: new Date().toISOString(),
      workspace: context.workspace,
      product: context.product,
      boards: exportedBoards,
      tags: tagRows.map((tag) => ({
        id: tag.id,
        boardId: tag.boardId,
        name: tag.name,
        color: tag.color,
      })),
      requests: [],
      merges: mergeRows.map(exportMerge),
    };
  }

  const [
    commentRows,
    teamVoteRows,
    customerVoteRows,
    followerRows,
    reactionRows,
    attachmentRows,
    tagLinkRows,
    customerRows,
    authorRows,
  ] = await Promise.all([
    db
      .select()
      .from(feedbackComments)
      .where(eq(feedbackComments.productId, input.productId)),
    db.select().from(feedbackVotes).where(inArray(feedbackVotes.feedbackPostId, postIds)),
    db
      .select()
      .from(feedbackCustomerVotes)
      .where(inArray(feedbackCustomerVotes.feedbackPostId, postIds)),
    db
      .select()
      .from(feedbackFollowers)
      .where(inArray(feedbackFollowers.feedbackPostId, postIds)),
    db
      .select()
      .from(feedbackReactions)
      .where(
        or(
          inArray(feedbackReactions.feedbackPostId, postIds),
          inArray(
            feedbackReactions.feedbackCommentId,
            commentIds.length > 0 ? commentIds : ["00000000-0000-0000-0000-000000000000"],
          ),
        ),
      ),
    db
      .select()
      .from(feedbackAttachments)
      .where(eq(feedbackAttachments.productId, input.productId)),
    db
      .select()
      .from(feedbackTagLinks)
      .where(inArray(feedbackTagLinks.feedbackPostId, postIds)),
    db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
      })
      .from(customers)
      .where(eq(customers.workspaceId, input.workspaceId)),
    db
      .select({
        postId: feedbackPosts.id,
        customerId: feedbackPosts.authorCustomerId,
        label: feedbackPosts.authorLabel,
        email: feedbackPosts.authorEmail,
        company: feedbackPosts.authorCompany,
      })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.productId, input.productId)),
  ]);

  const customerById = new Map(customerRows.map((row) => [row.id, row]));
  const authorByPost = new Map(authorRows.map((row) => [row.postId, row]));
  const tagNameById = new Map(tagRows.map((row) => [row.id, row.name]));
  const boardById = new Map(boardRows.map((row) => [row.id, row]));
  const importById = new Map(importRows.map((row) => [row.id, row]));
  const postById = new Map(postRows.map((row) => [row.id, row]));

  const tagNamesByPost = new Map<string, string[]>();
  for (const link of tagLinkRows) {
    const name = tagNameById.get(link.tagId);
    if (!name) continue;
    tagNamesByPost.set(link.feedbackPostId, [
      ...(tagNamesByPost.get(link.feedbackPostId) ?? []),
      name,
    ]);
  }

  const commentById = new Map(commentRows.map((comment) => [comment.id, comment]));
  const commentsByPost = new Map<string, ExportRequest["comments"]>();
  for (const comment of commentRows) {
    commentsByPost.set(comment.feedbackPostId, [
      ...(commentsByPost.get(comment.feedbackPostId) ?? []),
      {
        id: comment.id,
        authorName: comment.authorName,
        authorType: comment.authorType,
        body: comment.body,
        internal: comment.internal,
        createdAt: comment.createdAt.toISOString(),
      },
    ]);
  }

  const teamVotes = new Map<string, number>();
  for (const vote of teamVoteRows) {
    teamVotes.set(vote.feedbackPostId, (teamVotes.get(vote.feedbackPostId) ?? 0) + 1);
  }

  const customerVotes = new Map<string, number>();
  for (const vote of customerVoteRows) {
    customerVotes.set(vote.feedbackPostId, (customerVotes.get(vote.feedbackPostId) ?? 0) + 1);
  }

  const followersByPost = new Map<string, ExportRequest["followers"]>();
  for (const follower of followerRows) {
    const customer = customerById.get(follower.customerId);
    followersByPost.set(follower.feedbackPostId, [
      ...(followersByPost.get(follower.feedbackPostId) ?? []),
      {
        customerId: follower.customerId,
        name: customer?.name ?? null,
        email: customer?.email ?? null,
        source: follower.source,
      },
    ]);
  }

  const reactionsByPost = new Map<string, ExportRequest["reactions"]>();
  for (const reaction of reactionRows) {
    const postId =
      reaction.feedbackPostId ??
      (reaction.feedbackCommentId
        ? commentById.get(reaction.feedbackCommentId)?.feedbackPostId ?? null
        : null);
    if (!postId) continue;

    const customer = customerById.get(reaction.customerId);
    reactionsByPost.set(postId, [
      ...(reactionsByPost.get(postId) ?? []),
      {
        kind: reaction.kind,
        customerId: reaction.customerId,
        name: customer?.name ?? null,
        email: customer?.email ?? null,
      },
    ]);
  }

  const attachmentsByPost = new Map<string, ExportRequest["attachments"]>();
  for (const attachment of attachmentRows) {
    const postId =
      attachment.feedbackPostId ??
      (attachment.feedbackCommentId
        ? commentById.get(attachment.feedbackCommentId)?.feedbackPostId ?? null
        : null);
    if (!postId) continue;

    attachmentsByPost.set(postId, [
      ...(attachmentsByPost.get(postId) ?? []),
      {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        storageKey: attachment.storageKey,
        target: attachment.feedbackPostId ? "request" : "comment",
      },
    ]);
  }

  const requests: ExportRequest[] = postRows.map((post) => {
    const author = authorByPost.get(post.id);
    const customer = author?.customerId ? customerById.get(author.customerId) : null;
    const board = post.boardId ? boardById.get(post.boardId) : null;
    const mergedTarget = post.mergedIntoId ? postById.get(post.mergedIntoId) : null;
    const sourceImport = post.importId ? importById.get(post.importId) : null;
    const team = teamVotes.get(post.id) ?? 0;
    const customerCount = customerVotes.get(post.id) ?? 0;

    return {
      id: post.id,
      board: { id: board?.id ?? null, name: board?.name ?? null, slug: board?.slug ?? null },
      title: post.title,
      body: post.body,
      status: post.status,
      category: post.category,
      source: post.source,
      author: {
        customerId: author?.customerId ?? null,
        name: customer?.name ?? author?.label ?? null,
        label: author?.label ?? null,
        email: customer?.email ?? author?.email ?? null,
        company: author?.company ?? null,
      },
      votes: {
        team,
        customer: customerCount,
        imported: post.importedVoteCount,
        total: team + customerCount + post.importedVoteCount,
      },
      tags: tagNamesByPost.get(post.id) ?? [],
      comments: commentsByPost.get(post.id) ?? [],
      followers: followersByPost.get(post.id) ?? [],
      reactions: reactionsByPost.get(post.id) ?? [],
      attachments: attachmentsByPost.get(post.id) ?? [],
      mergedInto: mergedTarget
        ? {
            id: mergedTarget.id,
            title: mergedTarget.title,
            status: mergedTarget.status,
          }
        : null,
      import: sourceImport
        ? {
            id: sourceImport.id,
            fileName: sourceImport.fileName,
            rowNumber: post.importRowNumber,
          }
        : null,
      hidden: post.hiddenAt !== null,
      archived: post.archivedAt !== null,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    workspace: context.workspace,
    product: context.product,
    boards: exportedBoards,
    tags: tagRows.map((tag) => ({
      id: tag.id,
      boardId: tag.boardId,
      name: tag.name,
      color: tag.color,
    })),
    requests,
    merges: mergeRows.map(exportMerge),
  };
}

function exportBoard(board: typeof boards.$inferSelect) {
  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    description: board.description,
    visibility: board.visibility,
    guestPosting: board.guestPosting,
    archived: board.archivedAt !== null,
    createdAt: board.createdAt.toISOString(),
  };
}

function exportMerge(merge: typeof feedbackMerges.$inferSelect) {
  return {
    id: merge.id,
    sourcePostId: merge.sourcePostId,
    targetPostId: merge.targetPostId,
    sourceStatus: merge.sourceStatus,
    undone: merge.undoneAt !== null,
    createdAt: merge.createdAt.toISOString(),
  };
}

/**
 * One row per request, including merged duplicates.
 *
 * `merged_into_id` and `merged_into_title` are always present as columns so a
 * spreadsheet filter can separate canonical requests from duplicates.
 */
export function buildRequestsCsv(bundle: ExportBundle): string {
  const rows: (string | number)[][] = [
    [
      "id",
      "board",
      "title",
      "body",
      "status",
      "category",
      "source",
      "author_name",
      "author_email",
      "votes_total",
      "votes_team",
      "votes_customer",
      "votes_imported",
      "comments",
      "tags",
      "merged_into_id",
      "merged_into_title",
      "hidden",
      "archived",
      "created_at",
      "updated_at",
    ],
  ];

  for (const request of bundle.requests) {
    rows.push([
      request.id,
      request.board.slug ?? "",
      request.title,
      request.body,
      request.status,
      request.category,
      request.source,
      request.author.name ?? "",
      request.author.email ?? "",
      request.votes.total,
      request.votes.team,
      request.votes.customer,
      request.votes.imported,
      request.comments.length,
      request.tags.join("; "),
      request.mergedInto?.id ?? "",
      request.mergedInto?.title ?? "",
      request.hidden ? "yes" : "no",
      request.archived ? "yes" : "no",
      request.createdAt,
      request.updatedAt,
    ]);
  }

  return toCsv(rows);
}
