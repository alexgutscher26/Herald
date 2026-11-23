import "server-only";

import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import { inAppNotifications } from "@/db/schema/notifications";
import { products, workspaces } from "@/db/schema/workspaces";
import { CUSTOMER_SESSION_COOKIE } from "@/features/customer-session/config";
import { findActiveCustomerSession } from "@/features/customer-session/session";

/**
 * The customer's in-app inbox.
 *
 * Rows are written by the notification fan-out inside the same transaction as
 * the status change, reply or release. Reading never trusts a customer id from
 * the request: it resolves the workspace-agnostic session cookie, checks the
 * session belongs to the workspace in the URL, and only then scopes the query.
 */

export type InAppInboxItem = {
  id: string;
  kind:
    | "feedback_status_changed"
    | "feedback_reply"
    | "release_published"
    | "outbound_message";
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
};

export type InAppInboxProduct = {
  workspace: { id: string; name: string; slug: string };
  product: { id: string; name: string; slug: string };
};

export type PublicInbox =
  | { state: "not_found" }
  | ({ state: "signed_out" } & InAppInboxProduct)
  | ({ state: "ready"; items: InAppInboxItem[]; unread: number } & InAppInboxProduct);

async function resolveInboxProduct(
  workspaceSlug: string,
  productSlug: string,
): Promise<InAppInboxProduct | null> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(products.slug, productSlug),
        or(
          eq(products.publicFeedbackEnabled, true),
          eq(products.publicRoadmapEnabled, true),
          eq(products.publicChangelogEnabled, true),
        ),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    workspace: { id: row.workspaceId, name: row.workspaceName, slug: row.workspaceSlug },
    product: { id: row.productId, name: row.productName, slug: row.productSlug },
  };
}

/**
 * Resolve the signed-in customer, but only for the product's workspace.
 * `sessionCookie` lets tests exercise the same authorization without a
 * request scope; production callers omit it and the cookie store is read.
 */
async function activeCustomerFor(
  product: InAppInboxProduct,
  sessionCookie?: string | null,
) {
  let cookieValue = sessionCookie;
  if (cookieValue === undefined) {
    const store = await cookies();
    cookieValue = store.get(CUSTOMER_SESSION_COOKIE)?.value ?? null;
  }

  const active = await findActiveCustomerSession(cookieValue ?? null);
  if (!active) return null;
  if (active.session.workspaceId !== product.workspace.id) return null;
  return active;
}

export async function publicUnreadNotificationCount(input: {
  workspaceSlug: string;
  productSlug: string;
  sessionCookie?: string | null;
}): Promise<number> {
  const product = await resolveInboxProduct(input.workspaceSlug, input.productSlug);
  if (!product) return 0;

  const active = await activeCustomerFor(product, input.sessionCookie);
  if (!active) return 0;

  const rows = await db
    .select({ value: count() })
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.productId, product.product.id),
        eq(inAppNotifications.customerId, active.customer.id),
        isNull(inAppNotifications.readAt),
      ),
    );

  return rows[0]?.value ?? 0;
}

export async function loadPublicInbox(input: {
  workspaceSlug: string;
  productSlug: string;
  limit?: number;
  sessionCookie?: string | null;
}): Promise<PublicInbox> {
  const product = await resolveInboxProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { state: "not_found" };

  const active = await activeCustomerFor(product, input.sessionCookie);
  if (!active) return { state: "signed_out", ...product };

  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 200);
  const [rows, unreadRows] = await Promise.all([
    db
      .select({
        id: inAppNotifications.id,
        kind: inAppNotifications.kind,
        title: inAppNotifications.title,
        body: inAppNotifications.body,
        href: inAppNotifications.href,
        readAt: inAppNotifications.readAt,
        createdAt: inAppNotifications.createdAt,
      })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.productId, product.product.id),
          eq(inAppNotifications.customerId, active.customer.id),
        ),
      )
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(limit),
    db
      .select({ value: count() })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.productId, product.product.id),
          eq(inAppNotifications.customerId, active.customer.id),
          isNull(inAppNotifications.readAt),
        ),
      ),
  ]);

  return {
    state: "ready",
    ...product,
    unread: unreadRows[0]?.value ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function markPublicNotificationsRead(input: {
  workspaceSlug: string;
  productSlug: string;
  sessionCookie?: string | null;
}): Promise<{ marked: number; signedIn: boolean }> {
  const product = await resolveInboxProduct(input.workspaceSlug, input.productSlug);
  if (!product) return { marked: 0, signedIn: false };

  const active = await activeCustomerFor(product, input.sessionCookie);
  if (!active) return { marked: 0, signedIn: false };

  const updated = await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.productId, product.product.id),
        eq(inAppNotifications.customerId, active.customer.id),
        isNull(inAppNotifications.readAt),
      ),
    )
    .returning({ id: inAppNotifications.id });

  return { marked: updated.length, signedIn: true };
}
