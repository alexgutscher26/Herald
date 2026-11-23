import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import { listConversationMacros } from "@/features/conversations/macros";
import { ThreadView } from "@/features/conversations/thread-view";
import {
  getConversationThread,
  listAssignableMembers,
  listMergeCandidates,
  markConversationRead,
} from "@/features/conversations/queries";
import { listOnlineOperators } from "@/features/operators/service";
import { requireProductContext } from "@/lib/authz";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_WORKSPACE_TIMEZONE } from "@/lib/workspace-time";

export const metadata = {
  title: "Conversation",
};

export default async function ConversationPage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    productSlug: string;
    conversationId: string;
  }>;
}) {
  const { workspaceSlug, productSlug, conversationId } = await params;

  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "conversation:read",
  );

  // Opening the thread is the read event. The unread counter is team-wide, so
  // clearing it here is idempotent and does not hide anything from a colleague.
  await markConversationRead({
    productId: context.product.id,
    conversationId,
    userId: context.user.id,
  });

  const [thread, members, requestBoards, requestOptions, online, macros] = await Promise.all([
    getConversationThread({
      productId: context.product.id,
      conversationId,
      userId: context.user.id,
    }),
    listAssignableMembers(context.workspace.id),
    db
      .select({ id: boards.id, name: boards.name })
      .from(boards)
      .where(
        and(
          eq(boards.productId, context.product.id),
          isNull(boards.archivedAt),
        ),
      )
      .orderBy(asc(boards.name)),
    // Requests this message can be linked to as evidence, instead of filing a
    // duplicate. Merged duplicates are excluded: demand belongs on the target.
    db
      .select({ id: feedbackPosts.id, title: feedbackPosts.title })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, context.product.id),
          isNull(feedbackPosts.archivedAt),
          isNull(feedbackPosts.mergedIntoId),
        ),
      )
      .orderBy(asc(feedbackPosts.title))
      .limit(100),
    listOnlineOperators(context.workspace.id),
    listConversationMacros(context.product.id),
  ]);

  if (!thread) notFound();

  const mergeCandidates = await listMergeCandidates({
    productId: context.product.id,
    customerId: thread.customer.id,
    excludeConversationId: thread.conversation.id,
  });

  return (
    <ThreadView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      thread={thread}
      members={members}
      boards={requestBoards}
      requests={requestOptions}
      canWrite={hasPermission(context.role, "conversation:write")}
      workspaceTimezone={DEFAULT_WORKSPACE_TIMEZONE}
      currentUserId={context.user.id}
      online={online}
      macros={macros}
      mergeCandidates={mergeCandidates}
    />
  );
}
