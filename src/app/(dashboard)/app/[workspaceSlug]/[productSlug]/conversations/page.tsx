import { ConversationsView } from "@/features/conversations/conversations-view";
import { parseInboxFilters } from "@/features/conversations/filters";
import {
  listAssignableMembers,
  listConversationNotifications,
  listConversationTags,
  listConversations,
  listDueReminders,
} from "@/features/conversations/queries";
import { touchOperatorPresence } from "@/features/operators/service";
import { resolveProductPage } from "@/lib/product-page";
import { now as nowInstant } from "@/lib/dates";
import { DEFAULT_WORKSPACE_TIMEZONE } from "@/lib/workspace-time";

export const metadata = {
  title: "Inbox",
};

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const query = await searchParams;

  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "conversation:read");
  const filters = parseInboxFilters(query);
  const now = nowInstant();

  // Opening the inbox is the operator heartbeat. Editors are ignored by the
  // service, so a read-only member never becomes "online" to customers.
  await touchOperatorPresence({
    workspaceId: context.workspace.id,
    userId: context.user.id,
    now,
  });

  const [inbox, reminders, members, notifications, tags] = await Promise.all([
    listConversations({
      productId: context.product.id,
      userId: context.user.id,
      filters,
      now,
    }),
    listDueReminders({
      productId: context.product.id,
      userId: context.user.id,
      now,
    }),
    listAssignableMembers(context.workspace.id),
    listConversationNotifications({
      productId: context.product.id,
      userId: context.user.id,
    }),
    listConversationTags(context.product.id),
  ]);

  return (
    <ConversationsView
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      filters={filters}
      items={inbox.items}
      counts={inbox.counts}
      reminders={reminders}
      notifications={notifications}
      members={members}
      tags={tags}
      workspaceTimezone={DEFAULT_WORKSPACE_TIMEZONE}
      currentUserId={context.user.id}
    />
  );
}
