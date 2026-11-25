import "server-only";

import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { checkWorkspaceEmailAllowance } from "@/features/entitlements/entitlements";
import { boards } from "@/db/schema/boards";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { feedbackComments, feedbackPosts } from "@/db/schema/feedback";
import { outboundMessages } from "@/db/schema/engagement";
import { workspaceBranding } from "@/db/schema/branding";
import { notificationDeliveries } from "@/db/schema/notifications";
import { releases } from "@/db/schema/releases";
import { subscribers } from "@/db/schema/subscribers";
import {
  customerAccounts,
  winbackCampaignRecipients,
  winbackCampaigns,
} from "@/db/schema/winback";
import { products, workspaces } from "@/db/schema/workspaces";
import {
  publicChangelogEntryPath,
  publicChangelogPath,
  publicCsatPath,
  publicPreferencesPath,
  publicRequestPath,
} from "@/features/public/paths";
import { isValidEmail } from "@/lib/email";
import { translatedOutbound } from "@/features/i18n/content";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";
import { isSandboxMode } from "@/lib/sandbox";

import { ensurePreferenceToken } from "@/features/subscribers/preference-token";
import {
  isQuietHoursTemplate,
  isWithinQuietHours,
  quietHoursDeferral,
  quietHoursWindowFromFields,
} from "@/features/subscribers/quiet-hours";

import { getSenderIdentity, senderIdentityProblem } from "./identity";
import { sendEmail, type SendEmailResult } from "./provider";
import { isEmailSuppressed } from "./suppressions";
import { conversationReplyAddress } from "./inbound-address";
import {
  isMarketingTemplate,
  listUnsubscribeHeaders,
} from "./unsubscribe";
import {
  renderAwayReplyEmail,
  renderConversationNotificationEmail,
  renderConversationCsatEmail,
  renderConversationReplyEmail,
  renderConversationTranscriptEmail,
  renderFeedbackReplyEmail,
  renderFeedbackStatusEmail,
  renderReleasePublishedEmail,
  renderTestEmail,
  renderWeeklyDigestEmail,
  renderOutboundMessageEmail,
  renderWinbackCampaignEmail,
  renderWinbackCampaignTestEmail,
} from "./templates";

/**
 * Sending service.
 *
 * `notificationDeliveries` is the outbox: one row per intended message, with a
 * unique dedupe key. The provider call is made after the suppression check and
 * the row is updated exactly once with the outcome.
 */

const MAX_DELIVERY_ATTEMPTS = 3;

const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  closed: "Closed",
};

export type DeliverySendOutcome = {
  deliveryId: string;
  status: "sent" | "skipped" | "failed" | "pending";
  providerMessageId?: string;
  error?: string;
  /** True when the row is waiting for the subscriber's quiet window to close. */
  deferred?: boolean;
};

export type PendingEmailSummary = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  deferred: number;
  results: DeliverySendOutcome[];
};

export async function sendTestEmail(input: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug?: string | undefined;
  productName?: string | undefined;
  productSlug?: string | undefined;
  to: string;
  mode?: "test" | "customer" | undefined;
}): Promise<SendEmailResult> {
  const email = input.to.trim();
  if (!isValidEmail(email)) {
    return { ok: false, error: "Enter a valid email address.", retryable: false };
  }
  if (await isEmailSuppressed(input.workspaceId, email)) {
    return {
      ok: false,
      error: "That address is on the suppression list.",
      retryable: false,
    };
  }
  if (isSandboxMode()) {
    return {
      ok: false,
      error: "Sandbox mode: email is suppressed.",
      retryable: false,
    };
  }

  if (input.mode === "customer") {
    if (!input.workspaceSlug || !input.productName || !input.productSlug) {
      return {
        ok: false,
        error: "Customer preview needs a product context.",
        retryable: false,
      };
    }
    const sender = await getSenderIdentity(input.workspaceId);
    const senderProblem = senderIdentityProblem(sender);
    if (senderProblem) {
      return { ok: false, error: senderProblem, retryable: false };
    }
    const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
    const rendered = renderReleasePublishedEmail({
      productName: input.productName,
      releaseTitle: "A clearer way to share what's new",
      summary:
        "This sample shows the customer-facing update email, including its sender identity and footer. No subscription was created for this address.",
      url: `${origin}${publicChangelogPath(input.workspaceSlug, input.productSlug)}`,
      sample: true,
    });
    return sendEmail({
      to: email,
      from: sender.from,
      replyTo: sender.replyTo ?? undefined,
      ...rendered,
    });
  }

  const rendered = renderTestEmail({ workspaceName: input.workspaceName });
  return sendEmail({ to: email, ...rendered });
}

export async function sendWinbackCampaignTest(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  to: string;
}): Promise<SendEmailResult> {
  const email = input.to.trim();
  if (!isValidEmail(email)) {
    return { ok: false, error: "Enter a valid email address.", retryable: false };
  }
  if (await isEmailSuppressed(input.workspaceId, email)) {
    return {
      ok: false,
      error: "That address is on the suppression list.",
      retryable: false,
    };
  }
  if (isSandboxMode()) {
    return {
      ok: false,
      error: "Sandbox mode: email is suppressed.",
      retryable: false,
    };
  }

  const rows = await db
    .select({
      campaign: winbackCampaigns,
      productName: products.name,
      productSlug: products.slug,
      workspaceSlug: workspaces.slug,
      releaseTitle: releases.title,
      releaseSlug: releases.slug,
      releaseStatus: releases.status,
    })
    .from(winbackCampaigns)
    .innerJoin(products, eq(winbackCampaigns.productId, products.id))
    .innerJoin(workspaces, eq(winbackCampaigns.workspaceId, workspaces.id))
    .leftJoin(
      releases,
      and(
        eq(releases.id, winbackCampaigns.releaseId),
        eq(releases.productId, winbackCampaigns.productId),
      ),
    )
    .where(
      and(
        eq(winbackCampaigns.id, input.campaignId),
        eq(winbackCampaigns.productId, input.productId),
        eq(winbackCampaigns.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "Campaign not found.", retryable: false };
  if (row.campaign.stoppedAt) {
    return { ok: false, error: "This campaign was stopped.", retryable: false };
  }
  if (row.campaign.releaseId && row.releaseStatus !== "published") {
    return {
      ok: false,
      error: "The linked release must be published before testing this campaign.",
      retryable: false,
    };
  }

  const sender = await getSenderIdentity(input.workspaceId);
  const senderProblem = senderIdentityProblem(sender);
  if (senderProblem) {
    return { ok: false, error: senderProblem, retryable: false };
  }

  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  const rendered = renderWinbackCampaignTestEmail({
    productName: row.productName,
    campaignName: row.campaign.name,
    description: row.campaign.description ?? "A new update is available.",
    releaseTitle: row.releaseTitle ?? undefined,
    postalAddress: sender.postalAddress,
    url: row.releaseSlug
      ? `${origin}${publicChangelogEntryPath(
          row.workspaceSlug,
          row.productSlug,
          row.releaseSlug,
        )}`
      : `${origin}${publicChangelogPath(row.workspaceSlug, row.productSlug)}`,
  });

  return sendEmail({
    to: email,
    from: sender.from,
    ...rendered,
    replyTo: sender.replyTo ?? undefined,
  });
}

export async function sendNotificationDelivery(
  deliveryId: string,
): Promise<DeliverySendOutcome> {
  const rows = await db
    .select({
      delivery: notificationDeliveries,
      releaseTitle: releases.title,
      releaseSummary: releases.summary,
      releaseSlug: releases.slug,
      productName: products.name,
      productSlug: products.slug,
      productChangelogEnabled: products.publicChangelogEnabled,
      workspaceSlug: workspaces.slug,
      unsubscribeToken: subscribers.unsubscribeToken,
      winbackOptedOutAt: subscribers.winbackOptedOutAt,
      quietHoursStart: subscribers.quietHoursStart,
      quietHoursEnd: subscribers.quietHoursEnd,
      quietHoursTimezone: subscribers.quietHoursTimezone,
      outboundTitle: outboundMessages.title,
      outboundBody: outboundMessages.body,
      outboundTranslations: outboundMessages.translations,
      outboundCtaLabel: outboundMessages.ctaLabel,
      outboundCtaUrl: outboundMessages.ctaUrl,
      contentTranslationEnabled: workspaceBranding.contentTranslationEnabled,
      customerTraits: customers.traits,
    })
    .from(notificationDeliveries)
    .innerJoin(products, eq(notificationDeliveries.productId, products.id))
    .innerJoin(workspaces, eq(notificationDeliveries.workspaceId, workspaces.id))
    .leftJoin(releases, eq(notificationDeliveries.releaseId, releases.id))
    .leftJoin(
      outboundMessages,
      eq(notificationDeliveries.outboundMessageId, outboundMessages.id),
    )
    .leftJoin(
      customers,
      eq(notificationDeliveries.recipientCustomerId, customers.id),
    )
    .leftJoin(
      workspaceBranding,
      eq(notificationDeliveries.workspaceId, workspaceBranding.workspaceId),
    )
    .leftJoin(
      subscribers,
      and(
        eq(subscribers.productId, notificationDeliveries.productId),
        eq(subscribers.emailNormalized, notificationDeliveries.recipientEmailNormalized),
      ),
    )
    .where(eq(notificationDeliveries.id, deliveryId))
    .limit(1);

  const row = rows[0];
  if (!row) return { deliveryId, status: "failed", error: "Delivery not found." };

  const { delivery } = row;
  if (
    delivery.status === "sent" ||
    delivery.status === "skipped" ||
    delivery.status === "bounced" ||
    delivery.status === "complained"
  ) {
    return { deliveryId, status: delivery.status === "sent" ? "sent" : "skipped" };
  }
  if (delivery.status === "failed") {
    return { deliveryId, status: "failed", error: delivery.error ?? "Delivery failed." };
  }

  const attemptCount = delivery.attemptCount + 1;
  const now = new Date();

  // A deferred row does not consume an attempt. The periodic sweep picks it up
  // again once its marker has passed and re-evaluates the window.
  if (delivery.deferUntil && delivery.deferUntil.getTime() > now.getTime()) {
    return {
      deliveryId,
      status: "pending",
      deferred: true,
      error: "Quiet hours: waiting for the subscriber's local window to close.",
    };
  }

  const quietWindow = quietHoursWindowFromFields({
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    quietHoursTimezone: row.quietHoursTimezone,
  });
  if (
    quietWindow &&
    isQuietHoursTemplate(delivery.template) &&
    isWithinQuietHours(quietWindow, now)
  ) {
    const deferUntil = quietHoursDeferral(now);
    const error = "Quiet hours: waiting for the subscriber's local window to close.";
    await db
      .update(notificationDeliveries)
      .set({ deferUntil, error, updatedAt: now })
      .where(eq(notificationDeliveries.id, delivery.id));
    return { deliveryId, status: "pending", deferred: true, error };
  }

  if (await isEmailSuppressed(delivery.workspaceId, delivery.recipientEmail)) {
    await db
      .update(notificationDeliveries)
      .set({
        status: "skipped",
        attemptCount,
        deferUntil: null,
        error: "Address is on the suppression list.",
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, delivery.id));
    return { deliveryId, status: "skipped", error: "Address is suppressed." };
  }

  if (isSandboxMode()) {
    return markSkipped(
      delivery.id,
      attemptCount,
      "Sandbox mode: email is suppressed.",
      now,
    );
  }

  // The plan's monthly email allowance is a delivery gate, not only a number
  // on the pricing page. Count confirmed sends for the workspace and skip the
  // row once the plan is exhausted; the operator can still see it in the log.
  const allowance = await checkWorkspaceEmailAllowance(delivery.workspaceId);
  if (!allowance.allowed) {
    return markSkipped(
      delivery.id,
      attemptCount,
      `Monthly email allowance reached (${allowance.limit ?? 0} emails on the ${allowance.plan} plan). Upgrade to send more.`,
      now,
    );
  }

  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  const marketing = isMarketingTemplate(delivery.template);
  let unsubscribeToken = row.unsubscribeToken;
  if (marketing && !unsubscribeToken) {
    // Older outbound rows may predate token creation. A marketing message must
    // not leave without a working unsubscribe link.
    unsubscribeToken = await ensurePreferenceToken({
      productId: delivery.productId,
      email: delivery.recipientEmail,
      emailNormalized: delivery.recipientEmailNormalized,
      customerId: delivery.recipientCustomerId,
    }).catch(() => null);
    if (!unsubscribeToken) {
      return markFailed(
        delivery.id,
        attemptCount,
        "Could not create the unsubscribe link for this marketing email.",
        now,
      );
    }
  }
  const preferencesUrl = unsubscribeToken
    ? `${origin}${publicPreferencesPath(
        row.workspaceSlug,
        row.productSlug,
        unsubscribeToken,
      )}`
    : undefined;

  let rendered;
  let replyTo: string | undefined;
  let from: string | undefined;
  if (delivery.template === "release_published") {
    if (!row.releaseTitle || !row.releaseSlug) {
      return markFailed(delivery.id, attemptCount, "Release data is missing.", now);
    }
    rendered = renderReleasePublishedEmail({
      productName: row.productName,
      releaseTitle: row.releaseTitle,
      summary: row.releaseSummary ?? "A new update is available.",
      url: `${origin}${publicChangelogEntryPath(
        row.workspaceSlug,
        row.productSlug,
        row.releaseSlug,
      )}`,
      preferencesUrl,
    });
  } else if (
    delivery.template === "weekly_digest" ||
    delivery.template === "daily_digest"
  ) {
    if (!row.productChangelogEnabled) {
      return markSkipped(
        delivery.id,
        attemptCount,
        "The public changelog is not enabled for this product.",
        now,
      );
    }
    // Use the queue time, not the send attempt time, so a retry renders the
    // same period the digest was queued for.
    const cadence = delivery.template === "daily_digest" ? "daily" : "weekly";
    const windowMs = cadence === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const weekStart = new Date(delivery.createdAt.getTime() - windowMs);
    const recent = await db
      .select({ title: releases.title, summary: releases.summary })
      .from(releases)
      .where(
        and(
          eq(releases.productId, delivery.productId),
          eq(releases.status, "published"),
          eq(releases.channelPublicChangelog, true),
          gte(releases.publishedAt, weekStart),
        ),
      )
      .orderBy(desc(releases.publishedAt))
      .limit(10);

    if (recent.length === 0) {
      return markSkipped(
        delivery.id,
        attemptCount,
        "No published updates were available for this digest.",
        now,
      );
    }

    rendered = renderWeeklyDigestEmail({
      productName: row.productName,
      items: recent.map((item) => ({
        title: item.title,
        summary: item.summary ?? "",
      })),
      url: `${origin}${publicChangelogPath(row.workspaceSlug, row.productSlug)}`,
      preferencesUrl,
      cadence,
    });
  } else if (
    delivery.template === "feedback_status_changed" ||
    delivery.template === "feedback_reply"
  ) {
    if (!delivery.feedbackPostId) {
      return markFailed(delivery.id, attemptCount, "Feedback data is missing.", now);
    }

    const postRows = await db
      .select({
        title: feedbackPosts.title,
        status: feedbackPosts.status,
        boardSlug: boards.slug,
      })
      .from(feedbackPosts)
      .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
      .where(
        and(
          eq(feedbackPosts.id, delivery.feedbackPostId),
          eq(feedbackPosts.productId, delivery.productId),
        ),
      )
      .limit(1);

    const post = postRows[0];
    if (!post) {
      return markFailed(delivery.id, attemptCount, "Feedback data is missing.", now);
    }

    const url = `${origin}${publicRequestPath(
      row.workspaceSlug,
      row.productSlug,
      post.boardSlug,
      delivery.feedbackPostId,
    )}`;

    if (delivery.template === "feedback_status_changed") {
      rendered = renderFeedbackStatusEmail({
        productName: row.productName,
        requestTitle: post.title,
        status: FEEDBACK_STATUS_LABELS[post.status] ?? post.status,
        url,
        preferencesUrl,
      });
    } else {
      if (!delivery.feedbackCommentId) {
        return markFailed(delivery.id, attemptCount, "Reply data is missing.", now);
      }
      const commentRows = await db
        .select({ body: feedbackComments.body, authorName: feedbackComments.authorName })
        .from(feedbackComments)
        .where(
          and(
            eq(feedbackComments.id, delivery.feedbackCommentId),
            eq(feedbackComments.feedbackPostId, delivery.feedbackPostId),
            eq(feedbackComments.productId, delivery.productId),
            eq(feedbackComments.internal, false),
          ),
        )
        .limit(1);
      const comment = commentRows[0];
      if (!comment) {
        return markFailed(delivery.id, attemptCount, "Reply data is missing.", now);
      }
      rendered = renderFeedbackReplyEmail({
        productName: row.productName,
        requestTitle: post.title,
        authorName: comment.authorName,
        body: comment.body,
        url,
        preferencesUrl,
      });
    }
  } else if (delivery.template === "conversation_transcript") {
    if (!delivery.conversationId) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    const rows = await db
      .select({
        subject: conversations.subject,
        body: conversationMessages.body,
        authorType: conversationMessages.authorType,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversations)
      .innerJoin(
        conversationMessages,
        and(
          eq(conversationMessages.conversationId, conversations.id),
          eq(conversationMessages.productId, conversations.productId),
        ),
      )
      .where(
        and(
          eq(conversations.id, delivery.conversationId),
          eq(conversations.productId, delivery.productId),
          eq(conversationMessages.kind, "message"),
          ne(conversationMessages.authorType, "system"),
        ),
      )
      .orderBy(asc(conversationMessages.createdAt))
      .limit(50);

    const conversation = rows[0];
    if (!conversation) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    rendered = renderConversationTranscriptEmail({
      productName: row.productName,
      subject: conversation.subject,
      messages: rows.map((message) => ({
        author:
          message.authorType === "customer"
            ? "Customer"
            : message.authorType === "juno"
              ? "Mira"
              : "Support team",
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      })),
    });
  } else if (delivery.template === "conversation_reply") {
    if (!delivery.conversationId || !delivery.conversationMessageId) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    const conversationRows = await db
      .select({ subject: conversations.subject, replyToken: conversations.replyToken })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, delivery.conversationId),
          eq(conversations.productId, delivery.productId),
        ),
      )
      .limit(1);

    const messageRows = await db
      .select({ body: conversationMessages.body })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, delivery.conversationMessageId),
          eq(conversationMessages.conversationId, delivery.conversationId),
          eq(conversationMessages.authorType, "team"),
          eq(conversationMessages.kind, "message"),
        ),
      )
      .limit(1);

    const conversation = conversationRows[0];
    const message = messageRows[0];
    if (!conversation || !message) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    replyTo = conversation.replyToken
      ? conversationReplyAddress(conversation.replyToken)
      : undefined;
    rendered = renderConversationReplyEmail({
      productName: row.productName,
      subject: conversation.subject,
      body: message.body,
      replyTo: replyTo ?? "",
    });
  } else if (delivery.template === "conversation_csat") {
    if (!delivery.conversationId) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }
    const rows = await db
      .select({ subject: conversations.subject, replyToken: conversations.replyToken })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, delivery.conversationId),
          eq(conversations.productId, delivery.productId),
          isNotNull(conversations.csatRequestedAt),
        ),
      )
      .limit(1);
    const conversation = rows[0];
    if (!conversation?.replyToken) {
      return markSkipped(
        delivery.id,
        attemptCount,
        "The conversation no longer has a rating link.",
        now,
      );
    }
    replyTo = conversationReplyAddress(conversation.replyToken);
    rendered = renderConversationCsatEmail({
      productName: row.productName,
      subject: conversation.subject,
      url: `${origin}${publicCsatPath(
        row.workspaceSlug,
        row.productSlug,
        delivery.conversationId,
      )}?token=${encodeURIComponent(conversation.replyToken)}`,
    });
  } else if (delivery.template === "conversation_notification") {
    if (!delivery.conversationId || !delivery.conversationMessageId) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    const rows = await db
      .select({
        subject: conversations.subject,
        customerName: customers.name,
        body: conversationMessages.body,
      })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .innerJoin(
        conversationMessages,
        and(
          eq(conversationMessages.id, delivery.conversationMessageId),
          eq(conversationMessages.conversationId, conversations.id),
          eq(conversationMessages.productId, conversations.productId),
        ),
      )
      .where(
        and(
          eq(conversations.id, delivery.conversationId),
          eq(conversations.productId, delivery.productId),
        ),
      )
      .limit(1);

    const conversation = rows[0];
    if (!conversation) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    rendered = renderConversationNotificationEmail({
      productName: row.productName,
      customerName: conversation.customerName ?? "Customer",
      subject: conversation.subject,
      preview: conversation.body.slice(0, 240),
      url: `${origin}/app/${encodeURIComponent(row.workspaceSlug)}/${encodeURIComponent(
        row.productSlug,
      )}/conversations/${delivery.conversationId}`,
    });
  } else if (delivery.template === "conversation_away_reply") {
    if (!delivery.conversationId || !delivery.conversationMessageId) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    const rows = await db
      .select({
        subject: conversations.subject,
        replyToken: conversations.replyToken,
        body: conversationMessages.body,
      })
      .from(conversations)
      .innerJoin(
        conversationMessages,
        and(
          eq(conversationMessages.id, delivery.conversationMessageId),
          eq(conversationMessages.conversationId, conversations.id),
          eq(conversationMessages.productId, conversations.productId),
        ),
      )
      .where(
        and(
          eq(conversations.id, delivery.conversationId),
          eq(conversations.productId, delivery.productId),
        ),
      )
      .limit(1);

    const conversation = rows[0];
    if (!conversation) {
      return markFailed(delivery.id, attemptCount, "Conversation data is missing.", now);
    }

    replyTo = conversation.replyToken
      ? conversationReplyAddress(conversation.replyToken)
      : undefined;
    rendered = renderAwayReplyEmail({
      productName: row.productName,
      subject: conversation.subject,
      body: conversation.body,
      replyTo: replyTo ?? "",
    });
  } else if (delivery.template === "winback_campaign") {
    if (!delivery.winbackRecipientId) {
      return markFailed(delivery.id, attemptCount, "Win-back recipient is missing.", now);
    }

    const campaignRows = await db
      .select({
        campaignName: winbackCampaigns.name,
        campaignDescription: winbackCampaigns.description,
        campaignMessageB: winbackCampaigns.messageB,
        campaignSendStatus: winbackCampaigns.sendStatus,
        recipientVariant: winbackCampaignRecipients.variant,
        releaseTitle: releases.title,
        releaseSlug: releases.slug,
        releaseStatus: releases.status,
        stoppedAt: winbackCampaigns.stoppedAt,
        customerStatus: customerAccounts.status,
        customerEligibility: customerAccounts.winbackEligibility,
        customerOptedOutAt: customerAccounts.winbackOptedOutAt,
      })
      .from(winbackCampaignRecipients)
      .innerJoin(
        winbackCampaigns,
        and(
          eq(winbackCampaigns.id, winbackCampaignRecipients.campaignId),
          eq(winbackCampaigns.workspaceId, delivery.workspaceId),
          eq(winbackCampaigns.productId, delivery.productId),
        ),
      )
      .leftJoin(
        releases,
        and(
          eq(releases.id, winbackCampaigns.releaseId),
          eq(releases.productId, delivery.productId),
        ),
      )
      .leftJoin(
        customerAccounts,
        eq(customerAccounts.id, winbackCampaignRecipients.customerAccountId),
      )
      .where(eq(winbackCampaignRecipients.id, delivery.winbackRecipientId))
      .limit(1);

    const campaign = campaignRows[0];
    if (!campaign) {
      return markFailed(delivery.id, attemptCount, "Campaign data is missing.", now);
    }
    if (campaign.campaignSendStatus === "paused") {
      // Pausing defers rather than deletes, so resuming can reuse this delivery.
      const deferUntil = new Date("9999-12-31T00:00:00.000Z");
      const error = "Campaign paused.";
      await db
        .update(notificationDeliveries)
        .set({ status: "pending", deferUntil, error, updatedAt: now })
        .where(eq(notificationDeliveries.id, delivery.id));
      return { deliveryId, status: "pending", deferred: true, error };
    }
    if (campaign.stoppedAt) {
      const skipped = await markSkipped(
        delivery.id,
        attemptCount,
        "The campaign was stopped before this message sent.",
        now,
      );
      await db
        .update(winbackCampaignRecipients)
        .set({
          status: "excluded",
          exclusionReason: "campaign_stopped",
          updatedAt: now,
        })
        .where(eq(winbackCampaignRecipients.id, delivery.winbackRecipientId));
      await refreshWinbackCampaignStatus(delivery.winbackRecipientId);
      return skipped;
    }
    if (campaign.releaseSlug && campaign.releaseStatus !== "published") {
      return markFailed(
        delivery.id,
        attemptCount,
        "The linked release is no longer published.",
        now,
      );
    }
    const winbackToken = unsubscribeToken;
    if (!winbackToken) {
      return markFailed(
        delivery.id,
        attemptCount,
        "The recipient has no preference token.",
        now,
      );
    }

    const ineligible =
      campaign.customerStatus !== "cancelled" ||
      campaign.customerEligibility !== "eligible";
    const optedOut =
      campaign.customerOptedOutAt !== null || row.winbackOptedOutAt !== null;
    if (ineligible || optedOut) {
      const skipped = await markSkipped(
        delivery.id,
        attemptCount,
        ineligible
          ? "The customer is no longer eligible for win-back email."
          : "The customer opted out of win-back email.",
        now,
      );
      await db
        .update(winbackCampaignRecipients)
        .set({
          status: "excluded",
          exclusionReason: ineligible ? "ineligible" : "winback_opted_out",
          updatedAt: now,
        })
        .where(eq(winbackCampaignRecipients.id, delivery.winbackRecipientId));
      await refreshWinbackCampaignStatus(delivery.winbackRecipientId);
      return skipped;
    }

    const sender = await getSenderIdentity(delivery.workspaceId);
    const senderProblem = senderIdentityProblem(sender);
    if (senderProblem) {
      return markFailed(delivery.id, attemptCount, senderProblem, now);
    }

    from = sender.from;
    replyTo = sender.replyTo ?? undefined;
    rendered = renderWinbackCampaignEmail({
      productName: row.productName,
      campaignName: campaign.campaignName,
      description:
        campaign.recipientVariant === "b" && campaign.campaignMessageB
          ? campaign.campaignMessageB
          : (campaign.campaignDescription ?? "A new update is available."),
      releaseTitle: campaign.releaseTitle ?? undefined,
      postalAddress: sender.postalAddress,
      preferencesUrl: `${origin}${publicPreferencesPath(
        row.workspaceSlug,
        row.productSlug,
        winbackToken,
      )}`,
      url: campaign.releaseSlug
        ? `${origin}${publicChangelogEntryPath(
            row.workspaceSlug,
            row.productSlug,
            campaign.releaseSlug,
          )}`
        : `${origin}${publicChangelogPath(row.workspaceSlug, row.productSlug)}`,
    });
  } else if (delivery.template === "outbound_message") {
    if (!delivery.outboundMessageId || !row.outboundTitle) {
      return markFailed(delivery.id, attemptCount, "Outbound message data is missing.", now);
    }
    const ctaUrl = row.outboundCtaUrl
      ? row.outboundCtaUrl.startsWith("http")
        ? row.outboundCtaUrl
        : `${origin}${row.outboundCtaUrl.startsWith("/") ? "" : "/"}${row.outboundCtaUrl}`
      : undefined;
    const customerLocale = (row.customerTraits as Record<string, unknown> | null)?.locale;
    const copy = translatedOutbound(
      {
        title: row.outboundTitle,
        body: row.outboundBody ?? "",
        ctaLabel: row.outboundCtaLabel,
        translations: row.outboundTranslations,
      },
      typeof customerLocale === "string" ? customerLocale : null,
      Boolean(row.contentTranslationEnabled),
    );
    rendered = renderOutboundMessageEmail({
      productName: row.productName,
      title: copy.title,
      body: copy.body,
      ctaLabel: copy.ctaLabel ?? undefined,
      ctaUrl,
      preferencesUrl,
    });
  } else {
    return markFailed(
      delivery.id,
      attemptCount,
      "This notification template is not supported.",
      now,
    );
  }

  const headers =
    marketing && unsubscribeToken
      ? listUnsubscribeHeaders(origin, unsubscribeToken)
      : undefined;

  const result = await sendEmail({
    to: delivery.recipientEmail,
    from,
    ...rendered,
    replyTo,
    headers,
    idempotencyKey: delivery.dedupeKey,
  });

  if (result.ok) {
    await db
      .update(notificationDeliveries)
      .set({
        status: "sent",
        attemptCount,
        deferUntil: null,
        providerMessageId: result.providerMessageId,
        sentAt: now,
        error: null,
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, delivery.id));

    if (delivery.template === "winback_campaign" && delivery.winbackRecipientId) {
      await db
        .update(winbackCampaignRecipients)
        .set({
          status: "sent",
          sentAt: now,
          providerMessageId: result.providerMessageId,
          sendAttempts: attemptCount,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(winbackCampaignRecipients.id, delivery.winbackRecipientId));
      await refreshWinbackCampaignStatus(delivery.winbackRecipientId);
    }

    return {
      deliveryId,
      status: "sent",
      providerMessageId: result.providerMessageId,
    };
  }

  const shouldRetry = result.retryable && attemptCount < MAX_DELIVERY_ATTEMPTS;
  await db
    .update(notificationDeliveries)
    .set({
      status: shouldRetry ? "pending" : "failed",
      attemptCount,
      deferUntil: null,
      error: result.error,
      updatedAt: now,
    })
    .where(eq(notificationDeliveries.id, delivery.id));

  if (
    !shouldRetry &&
    delivery.template === "winback_campaign" &&
    delivery.winbackRecipientId
  ) {
    await db
      .update(winbackCampaignRecipients)
      .set({
        status: "failed",
        sendAttempts: attemptCount,
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where(eq(winbackCampaignRecipients.id, delivery.winbackRecipientId));
    await refreshWinbackCampaignStatus(delivery.winbackRecipientId);
  }

  return {
    deliveryId,
    status: shouldRetry ? "pending" : "failed",
    error: result.error,
  };
}

async function refreshWinbackCampaignStatus(
  recipientId: string,
): Promise<void> {
  const recipientRows = await db
    .select({ campaignId: winbackCampaignRecipients.campaignId })
    .from(winbackCampaignRecipients)
    .where(eq(winbackCampaignRecipients.id, recipientId))
    .limit(1);
  const campaignId = recipientRows[0]?.campaignId;
  if (!campaignId) return;

  const counts = await db
    .select({
      pending: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'pending')::int`,
      failed: sql<number>`count(*) filter (where ${notificationDeliveries.status} in ('failed', 'bounced', 'complained'))::int`,
    })
    .from(notificationDeliveries)
    .innerJoin(
      winbackCampaignRecipients,
      eq(notificationDeliveries.winbackRecipientId, winbackCampaignRecipients.id),
    )
    .where(eq(winbackCampaignRecipients.campaignId, campaignId));

  const row = counts[0];
  if (!row || Number(row.pending) > 0) return;

  await db
    .update(winbackCampaigns)
    .set({
      sendStatus: Number(row.failed) > 0 ? "partially_sent" : "sent",
      updatedAt: new Date(),
    })
    .where(and(eq(winbackCampaigns.id, campaignId), isNull(winbackCampaigns.stoppedAt)));
}

async function markFailed(
  deliveryId: string,
  attemptCount: number,
  error: string,
  now: Date,
): Promise<DeliverySendOutcome> {
  await db
    .update(notificationDeliveries)
    .set({ status: "failed", attemptCount, deferUntil: null, error, updatedAt: now })
    .where(eq(notificationDeliveries.id, deliveryId));
  return { deliveryId, status: "failed", error };
}

async function markSkipped(
  deliveryId: string,
  attemptCount: number,
  reason: string,
  now: Date,
): Promise<DeliverySendOutcome> {
  await db
    .update(notificationDeliveries)
    .set({ status: "skipped", attemptCount, deferUntil: null, error: reason, updatedAt: now })
    .where(eq(notificationDeliveries.id, deliveryId));
  return { deliveryId, status: "skipped", error: reason };
}

/** Bounded outbox sweep used by the `deliver_notification` job. */
export async function deliverPendingEmails(limit = 25): Promise<PendingEmailSummary> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const now = new Date();
  const pending = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.status, "pending"),
        or(
          isNull(notificationDeliveries.deferUntil),
          lte(notificationDeliveries.deferUntil, now),
        ),
      ),
    )
    .orderBy(asc(notificationDeliveries.createdAt))
    .limit(bounded);

  const summary: PendingEmailSummary = {
    checked: pending.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    deferred: 0,
    results: [],
  };

  for (const row of pending) {
    try {
      const outcome = await sendNotificationDelivery(row.id);
      summary.results.push(outcome);
      if (outcome.status === "sent") summary.sent += 1;
      else if (outcome.status === "skipped") summary.skipped += 1;
      else if (outcome.deferred) summary.deferred += 1;
      else if (outcome.status === "pending") summary.retried += 1;
      else summary.failed += 1;
    } catch (error) {
      logEvent("error", "email.delivery_threw", {
        deliveryId: row.id,
        error: serializeError(error),
      });
      summary.failed += 1;
      summary.results.push({
        deliveryId: row.id,
        status: "failed",
        error: "Unexpected delivery error.",
      });
    }
  }

  return summary;
}
