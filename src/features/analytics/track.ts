import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { products, workspaces } from "@/db/schema";
import { analyticsEvents, type AnalyticsEventType } from "@/db/schema/analytics";
import { analyticsAllowed } from "@/features/consent/server";
import { log } from "@/lib/logger";
import { captureServerEventAfterResponse, postHogDistinctId } from "@/lib/posthog";

/**
 * Privacy-preserving event writes.
 *
 * A failure to record analytics must never break the customer action that
 * produced it, so the public helpers deliberately swallow write failures and
 * log them. No raw address, user agent or customer id is persisted.
 */

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function visitorHash(input: {
  workspaceId: string;
  productId: string;
  ip: string;
  userAgent: string;
  day: string;
}): string {
  return createHash("sha256")
    .update(
      [input.workspaceId, input.productId, input.day, input.ip, input.userAgent].join(
        "|",
      ),
    )
    .digest("hex");
}

export async function trackAnalyticsEvent(input: {
  workspaceId: string;
  productId: string;
  type: AnalyticsEventType;
  boardId?: string | null;
  feedbackPostId?: string | null;
  visitorHash?: string | null;
  metadata?: Record<string, string | number | boolean>;
  occurredAt?: Date;
}): Promise<void> {
  try {
    await db.insert(analyticsEvents).values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      type: input.type,
      boardId: input.boardId ?? null,
      feedbackPostId: input.feedbackPostId ?? null,
      visitorHash: input.visitorHash ?? null,
      metadata: input.metadata ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
  } catch (error) {
    log.warn("analytics.event_failed", {
      type: input.type,
      productId: input.productId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Record a public page view with a day-scoped, one-way visitor key. The hash
 * lets a future unique-view metric dedupe reloads without storing an IP.
 */
export async function trackPublicView(input: {
  workspaceId: string;
  productId: string;
  type:
    | "board_view"
    | "request_view"
    | "submit_started"
    | "widget_open"
    | "portal_page_view";
  boardId?: string | null;
  feedbackPostId?: string | null;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  // Public view analytics is optional. The consent decision is resolved before
  // any visitor hash is computed, so an opted-out request leaves no trace.
  if (!(await analyticsAllowed())) return;

  let hash: string | null = null;
  try {
    const requestHeaders = await headers();
    const forwarded = requestHeaders.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0]?.trim() || "unknown";
    const userAgent = requestHeaders.get("user-agent") ?? "unknown";
    hash = visitorHash({
      workspaceId: input.workspaceId,
      productId: input.productId,
      ip,
      userAgent,
      day: utcDay(new Date()),
    });
  } catch {
    // A server component can be rendered outside a request (for example in a
    // test); the event is still useful without a visitor key.
  }

  await trackAnalyticsEvent({ ...input, visitorHash: hash });

  // PostHog receives the same event the tenant dashboard already stores, after
  // the response is sent so a third-party round trip adds no latency. The
  // distinct id stays pseudonymous: the day-scoped visitor hash when there is
  // one, otherwise a per-product daily key. Only the page slug and a hashed
  // product key travel with the event.
  captureServerEventAfterResponse({
    event: input.type,
    distinctId: postHogDistinctId(hash ?? `${input.productId}:${utcDay(new Date())}`),
    properties: {
      surface: "public",
      product_key: postHogDistinctId(input.productId),
      ...(typeof input.metadata?.page === "string" ? { page: input.metadata.page } : {}),
    },
  });
}

/**
 * Record a roadmap or changelog visit. Those public views carry only slugs, so
 * the product/workspace ids are resolved here instead of widening every public
 * page projection. A failed resolution is logged by the event writer and never
 * breaks the page.
 */
export async function trackPortalPageView(input: {
  workspaceSlug: string;
  productSlug: string;
  page: "home" | "roadmap" | "updates";
}): Promise<void> {
  try {
    const rows = await db
      .select({ workspaceId: products.workspaceId, productId: products.id })
      .from(products)
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(
        and(eq(workspaces.slug, input.workspaceSlug), eq(products.slug, input.productSlug)),
      )
      .limit(1);
    const product = rows[0];
    if (!product) return;
    await trackPublicView({
      workspaceId: product.workspaceId,
      productId: product.productId,
      type: "portal_page_view",
      metadata: { page: input.page },
    });
  } catch (error) {
    log.warn("analytics.portal_view_failed", {
      page: input.page,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
