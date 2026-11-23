import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import {
  billingChurnFeedback,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces,
} from "@/db/schema";
import { sendEmail } from "@/features/email/provider";
import {
  renderBillingWinbackEmail,
  renderDunningEmail,
  renderPaymentFailedEmail,
  renderTrialEndingEmail,
} from "@/features/email/templates";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Billing notifications are intentionally separate from product email.
 *
 * They go only to workspace owners, never to customers, and are keyed by a
 * billing notice rather than an unsubscribe-able product preference. The job
 * queue supplies the outer dedupe key; the provider idempotency key prevents a
 * retry from double-sending to an owner who already received the message.
 */

export type BillingNoticeKind =
  | "trial_ending"
  | "payment_failed"
  | "dunning_reminder"
  | "dunning_final"
  | "billing_winback";

export type BillingNotice = {
  workspaceId: string;
  kind: BillingNoticeKind;
  /** Stable identifier for the trial period or Stripe event. */
  noticeKey: string;
  trialEndsAt?: string | undefined;
  invoiceUrl?: string | undefined;
  amountDue?: number | undefined;
  currency?: string | undefined;
  nextAttemptAt?: string | undefined;
  /** 1-based position in the dunning sequence. */
  stage?: 1 | 2 | 3 | undefined;
  graceEndsAt?: string | undefined;
  /** Set when a cancellation feedback row schedules the follow-up. */
  feedbackId?: string | undefined;
};

export type BillingEmailResult = {
  sent: number;
  failures: Array<{ email: string; error: string; retryable: boolean }>;
  skipped?: "no_owner" | "no_email" | "not_past_due" | "no_feedback" | "active";
};

function recipientKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function formatAmount(amountDue: number, currency: string): string {
  const code = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).format(amountDue / 100);
  } catch {
    return `${(amountDue / 100).toFixed(2)} ${code}`;
  }
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function sendBillingEmail(
  input: BillingNotice,
): Promise<BillingEmailResult> {
  const workspaceRows = await db
    .select({ name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) return { sent: 0, failures: [], skipped: "no_owner" };

  const [subscriptionRows, ownerRows] = await Promise.all([
    db
      .select({
        plan: workspaceSubscriptions.plan,
        status: workspaceSubscriptions.status,
        dunningGraceUntil: workspaceSubscriptions.dunningGraceUntil,
      })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
      .limit(1),
    db
      .select({ email: user.email, name: user.name })
      .from(workspaceMembers)
      .innerJoin(user, eq(workspaceMembers.userId, user.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.role, "owner"),
        ),
      ),
  ]);

  const subscription = subscriptionRows[0];
  if (
    (input.kind === "dunning_reminder" || input.kind === "dunning_final") &&
    subscription?.status !== "past_due" &&
    subscription?.status !== "unpaid"
  ) {
    return { sent: 0, failures: [], skipped: "not_past_due" };
  }

  const feedback =
    input.kind === "billing_winback"
      ? (
          await db
            .select({
              id: billingChurnFeedback.id,
              reason: billingChurnFeedback.reason,
              contactConsent: billingChurnFeedback.contactConsent,
            })
            .from(billingChurnFeedback)
            .where(
              input.feedbackId
                ? and(
                    eq(billingChurnFeedback.id, input.feedbackId),
                    eq(billingChurnFeedback.workspaceId, input.workspaceId),
                  )
                : and(
                    eq(billingChurnFeedback.workspaceId, input.workspaceId),
                    eq(billingChurnFeedback.contactConsent, true),
                    isNull(billingChurnFeedback.winbackSentAt),
                  ),
            )
            .orderBy(desc(billingChurnFeedback.createdAt))
            .limit(1)
        )[0]
      : null;
  if (input.kind === "billing_winback") {
    if (!feedback || !feedback.contactConsent) {
      return { sent: 0, failures: [], skipped: "no_feedback" };
    }
    if (
      subscription?.status === "active" ||
      subscription?.status === "trialing" ||
      subscription?.status === "lifetime"
    ) {
      return { sent: 0, failures: [], skipped: "active" };
    }
  }

  const recipients = [
    ...new Set(
      ownerRows
        .map((owner) => owner.email?.trim() ?? "")
        .filter((email) => email.length > 0),
    ),
  ];
  if (recipients.length === 0) {
    return { sent: 0, failures: [], skipped: "no_owner" };
  }

  const planName =
    subscription?.plan === "starter"
      ? "Indie"
      : subscription?.plan === "pro"
        ? "Professional"
        : "your paid";
  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  const billingUrl = `${origin}/app/${encodeURIComponent(workspace.slug)}/settings#billing`;

  const rendered =
    input.kind === "dunning_reminder" || input.kind === "dunning_final"
      ? renderDunningEmail({
          workspaceName: workspace.name,
          planName,
          stage: input.stage ?? (input.kind === "dunning_final" ? 3 : 1),
          amount: formatAmount(input.amountDue ?? 0, input.currency ?? "usd"),
          invoiceUrl: safeHttpUrl(input.invoiceUrl) ?? billingUrl,
          nextAttemptAt: input.nextAttemptAt ?? null,
          graceEndsAt: input.graceEndsAt ?? subscription?.dunningGraceUntil?.toISOString() ?? null,
        })
      : input.kind === "billing_winback"
        ? renderBillingWinbackEmail({
            workspaceName: workspace.name,
            planName,
            reason: feedback?.reason ?? "you were looking for a different fit",
            billingUrl,
          })
      : input.kind === "payment_failed"
      ? renderPaymentFailedEmail({
          workspaceName: workspace.name,
          planName,
          amount: formatAmount(input.amountDue ?? 0, input.currency ?? "usd"),
          invoiceUrl: safeHttpUrl(input.invoiceUrl) ?? billingUrl,
          nextAttemptAt: input.nextAttemptAt ?? null,
        })
      : renderTrialEndingEmail({
          workspaceName: workspace.name,
          planName,
          trialEndsAt: input.trialEndsAt ?? null,
          billingUrl,
        });

  const result: BillingEmailResult = { sent: 0, failures: [] };
  for (const email of recipients) {
    const sent = await sendEmail({
      to: email,
      ...rendered,
      idempotencyKey: `billing-${input.kind}-${input.noticeKey}-${recipientKey(email)}`,
    });
    if (sent.ok) {
      result.sent += 1;
      continue;
    }
    result.failures.push({
      email,
      error: sent.error,
      retryable: sent.retryable,
    });
    logEvent("warn", "billing.notice_failed", {
      workspaceId: input.workspaceId,
      kind: input.kind,
      retryable: sent.retryable,
      error: serializeError(new Error(sent.error)),
    });
  }

  if (input.kind === "billing_winback" && feedback && result.sent > 0) {
    await db
      .update(billingChurnFeedback)
      .set({ winbackSentAt: new Date() })
      .where(eq(billingChurnFeedback.id, feedback.id));
  }

  return result;
}
