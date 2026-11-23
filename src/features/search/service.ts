import "server-only";

import { and, desc, eq, exists, ilike, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { customers } from "@/db/schema/customers";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { feedbackPosts } from "@/db/schema/feedback";
import { helpArticles } from "@/db/schema/help";
import { releases } from "@/db/schema/releases";
import { hasPermission, type Permission, type WorkspaceRole } from "@/lib/permissions";

import {
  searchPattern,
  type GlobalSearchGroup,
  type GlobalSearchItem,
  type GlobalSearchKind,
} from "./query";

const GROUP_LIMIT = 5;

function group(
  kind: GlobalSearchKind,
  label: string,
  items: GlobalSearchItem[],
  allowed: boolean,
): GlobalSearchGroup[] {
  return allowed && items.length > 0 ? [{ kind, label, items }] : [];
}

/**
 * Search the records a workspace member can already open.
 *
 * Every query is scoped by the authorized product (or workspace for customers)
 * and every group is gated by the same permission its destination page checks.
 * Spam, archived and merged records stay out so the palette never offers a
 * result that the destination list would hide.
 */
export async function searchWorkspace(input: {
  workspaceId: string;
  productId: string;
  role: WorkspaceRole;
  permissions: readonly Permission[];
  workspaceSlug: string;
  productSlug: string;
  query: string;
}): Promise<GlobalSearchGroup[]> {
  const pattern = searchPattern(input.query);
  const base = `/app/${encodeURIComponent(input.workspaceSlug)}/${encodeURIComponent(
    input.productSlug,
  )}`;
  const can = (permission: Permission) =>
    input.permissions.includes(permission) || hasPermission(input.role, permission);

  const [requestRows, conversationRows, releaseRows, helpRows, customerRows] = await Promise.all([
    can("feedback:read")
      ? db
          .select({
            id: feedbackPosts.id,
            title: feedbackPosts.title,
            status: feedbackPosts.status,
          })
          .from(feedbackPosts)
          .where(
            and(
              eq(feedbackPosts.productId, input.productId),
              isNull(feedbackPosts.archivedAt),
              isNull(feedbackPosts.mergedIntoId),
              or(ilike(feedbackPosts.title, pattern), ilike(feedbackPosts.body, pattern)),
            ),
          )
          .orderBy(desc(feedbackPosts.updatedAt))
          .limit(GROUP_LIMIT)
      : Promise.resolve([]),
    can("conversation:read")
      ? db
          .select({
            id: conversations.id,
            subject: conversations.subject,
            customerName: customers.name,
            customerEmail: customers.email,
          })
          .from(conversations)
          .innerJoin(customers, eq(conversations.customerId, customers.id))
          .where(
            and(
              eq(conversations.productId, input.productId),
              ne(conversations.status, "spam"),
              ne(conversations.status, "archived"),
              or(
                ilike(conversations.subject, pattern),
                ilike(conversations.lastMessagePreview, pattern),
                ilike(customers.name, pattern),
                ilike(customers.email, pattern),
                // The palette must find a thread from any message body, not
                // only the denormalised preview the inbox kept.
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(conversationMessages)
                    .where(
                      and(
                        eq(conversationMessages.conversationId, conversations.id),
                        eq(conversationMessages.productId, conversations.productId),
                        ilike(conversationMessages.body, pattern),
                      ),
                    ),
                ),
              ),
            ),
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(GROUP_LIMIT)
      : Promise.resolve([]),
    can("release:read")
      ? db
          .select({
            id: releases.id,
            title: releases.title,
            status: releases.status,
          })
          .from(releases)
          .where(
            and(
              eq(releases.productId, input.productId),
              ne(releases.status, "archived"),
              or(ilike(releases.title, pattern), ilike(releases.summary, pattern)),
            ),
          )
          .orderBy(desc(releases.updatedAt))
          .limit(GROUP_LIMIT)
      : Promise.resolve([]),
    can("settings:manage")
      ? db
          .select({ id: helpArticles.id, title: helpArticles.title, status: helpArticles.status })
          .from(helpArticles)
          .where(
            and(
              eq(helpArticles.productId, input.productId),
              or(ilike(helpArticles.title, pattern), ilike(helpArticles.body, pattern)),
            ),
          )
          .orderBy(desc(helpArticles.updatedAt))
          .limit(GROUP_LIMIT)
      : Promise.resolve([]),
    can("conversation:read")
      ? db
          .select({ id: customers.id, name: customers.name, email: customers.email })
          .from(customers)
          .where(
            and(
              eq(customers.workspaceId, input.workspaceId),
              or(ilike(customers.name, pattern), ilike(customers.email, pattern)),
            ),
          )
          .orderBy(desc(customers.lastSeenAt))
          .limit(GROUP_LIMIT)
      : Promise.resolve([]),
  ]);

  return [
    ...group(
      "request",
      "Requests",
      requestRows.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `Request · ${row.status}`,
        href: `${base}/feedback?post=${encodeURIComponent(row.id)}`,
      })),
      can("feedback:read"),
    ),
    ...group(
      "conversation",
      "Inbox",
      conversationRows.map((row) => ({
        id: row.id,
        title: row.subject,
        subtitle: row.customerName ?? row.customerEmail ?? "Customer conversation",
        href: `${base}/conversations/${encodeURIComponent(row.id)}`,
      })),
      can("conversation:read"),
    ),
    ...group(
      "release",
      "Releases",
      releaseRows.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `Release · ${row.status}`,
        href: `${base}/releases/${encodeURIComponent(row.id)}/edit`,
      })),
      can("release:read"),
    ),
    ...group(
      "help",
      "Help articles",
      helpRows.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `Help article · ${row.status}`,
        href: `${base}/help/${encodeURIComponent(row.id)}`,
      })),
      can("settings:manage"),
    ),
    ...group(
      "customer",
      "Customers",
      customerRows.map((row) => {
        const needle = row.email ?? row.name ?? "";
        return {
          id: row.id,
          title: row.name ?? row.email ?? "Customer",
          subtitle: row.email ?? "Customer",
          href: `${base}/conversations?q=${encodeURIComponent(needle)}`,
        };
      }),
      can("conversation:read"),
    ),
  ];
}
