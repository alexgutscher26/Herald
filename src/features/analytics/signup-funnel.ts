import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { and, gte, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  SIGNUP_FUNNEL_STAGES,
  signupFunnelEvents,
  type SignupFunnelStage,
} from "@/db/schema/signup-funnel";
import { log } from "@/lib/logger";
import { captureServerEventAfterResponse, postHogDistinctId } from "@/lib/posthog";

import {
  SIGNUP_FUNNEL_LABELS,
  buildSignupFunnel,
  type SignupFunnelReport,
  type SignupFunnelStep,
} from "./signup-funnel-model";

export { SIGNUP_FUNNEL_LABELS, buildSignupFunnel };
export type { SignupFunnelReport, SignupFunnelStep };

/**
 * Signup funnel analytics.
 *
 * This is a company-level funnel, not a tenant metric: the first event happens
 * before an account or workspace exists. Events therefore store no workspace,
 * account, email, raw IP address or user agent. Milestone events carry a
 * one-way SHA-256 digest of the subject id so each subject counts once at that
 * stage; page views carry a day-scoped digest so a reload does not count twice.
 *
 * A failed write is logged and swallowed: analytics must never break sign-up,
 * workspace creation, publishing or widget delivery.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

async function insertEvent(stage: SignupFunnelStage, subjectHash: string | null) {
  try {
    const inserted = await db
      .insert(signupFunnelEvents)
      .values({ stage, subjectHash })
      .onConflictDoNothing()
      .returning({ id: signupFunnelEvents.id });

    // PostHog sees a stage only when the row was new, so a duplicate milestone
    // cannot inflate a funnel there either. The distinct id is derived from the
    // one-way subject hash, never from an email, account id or address.
    if (inserted.length > 0) {
      captureServerEventAfterResponse({
        event: stage,
        distinctId: postHogDistinctId(subjectHash ?? `${stage}:unattributed`),
        properties: { funnel: "signup" },
      });
    }
  } catch (error) {
    log.warn("signup_funnel.event_failed", {
      stage,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Count a server render of `/sign-up`. The hash uses the request address and
 * user agent only in memory; neither is persisted. A visitor is counted once
 * per UTC day so refreshing the page does not inflate the top of the funnel.
 */
export async function trackSignUpPageView(): Promise<void> {
  let subjectHash: string | null = null;
  try {
    const requestHeaders = await headers();
    const forwarded = requestHeaders.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0]?.trim() || "unknown";
    const userAgent = requestHeaders.get("user-agent") ?? "unknown";
    subjectHash = digest(
      ["sign_up_view", utcDay(new Date()), ip, userAgent].join("|"),
    );
  } catch {
    // A render outside a request still produces a useful aggregate view.
  }

  await insertEvent("sign_up_view", subjectHash);
}

/** Each account, workspace, product or installation counts at most once. */
export async function recordSignupFunnelMilestone(
  stage: Exclude<SignupFunnelStage, "sign_up_view">,
  subjectId: string,
): Promise<void> {
  await insertEvent(stage, digest(`${stage}:${subjectId}`));
}

export async function recordAccountCreated(userId: string): Promise<void> {
  await recordSignupFunnelMilestone("account_created", userId);
}

export async function recordWorkspaceCreated(workspaceId: string): Promise<void> {
  await recordSignupFunnelMilestone("workspace_created", workspaceId);
}

export async function recordFirstRelease(productId: string): Promise<void> {
  await recordSignupFunnelMilestone("first_release", productId);
}

export async function recordWidgetInstalled(productId: string): Promise<void> {
  await recordSignupFunnelMilestone("widget_installed", productId);
}

export async function getSignupFunnel(input?: {
  days?: number;
  now?: Date;
}): Promise<SignupFunnelReport> {
  const days = Math.min(Math.max(Math.trunc(input?.days ?? 30), 1), 365);
  const now = input?.now ?? new Date();
  const to = startOfUtcDay(now);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  const endExclusive = new Date(to.getTime() + DAY_MS);

  const rows = await db
    .select({
      stage: signupFunnelEvents.stage,
      count: sql<number>`count(*)::int`,
    })
    .from(signupFunnelEvents)
    .where(
      and(
        gte(signupFunnelEvents.occurredAt, from),
        lt(signupFunnelEvents.occurredAt, endExclusive),
      ),
    )
    .groupBy(signupFunnelEvents.stage);

  const counts = Object.fromEntries(
    SIGNUP_FUNNEL_STAGES.map((stage) => [stage, 0]),
  ) as Record<SignupFunnelStage, number>;
  for (const row of rows) {
    counts[row.stage] = Number(row.count);
  }

  return {
    days,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    steps: buildSignupFunnel(counts),
  };
}

/**
 * Funnel events are aggregate and identify no one, but they still get a
 * bounded life. The existing audit-retention job calls this with the same
 * daily sweep, so there is no second scheduler to forget.
 */
export async function pruneSignupFunnelEvents(input?: {
  now?: Date;
  retentionDays?: number;
}): Promise<{ pruned: number }> {
  const retentionDays = Math.max(30, Math.trunc(input?.retentionDays ?? 400));
  const cutoff = new Date(
    (input?.now ?? new Date()).getTime() - retentionDays * DAY_MS,
  );
  const deleted = await db
    .delete(signupFunnelEvents)
    .where(lt(signupFunnelEvents.occurredAt, cutoff))
    .returning({ id: signupFunnelEvents.id });
  return { pruned: deleted.length };
}
