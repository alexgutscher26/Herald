import "server-only";

import { z } from "zod";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { eq } from "drizzle-orm";
import { deliverPendingEmails, sendNotificationDelivery } from "@/features/email/send";
import { processFeedbackImport } from "@/features/import/service";
import { answerConversation } from "@/features/juno/answer";
import { sweepJunoAutoResolve } from "@/features/juno/automation";
import {
  suggestDuplicatesForPost,
  suggestTagsForPost,
} from "@/features/juno/auxiliary";
import { runKnowledgeCrawl } from "@/features/juno/crawl-runner";
import { enqueueDueDigests } from "@/features/notifications/digest";
import {
  purgeDueWorkspaces,
  pruneAuditEvents,
} from "@/features/data-controls/service";
import {
  recalculateAnalyticsForAllProducts,
  recalculateAnalyticsWindow,
} from "@/features/analytics/rollup";
import { pruneSignupFunnelEvents } from "@/features/analytics/signup-funnel";
import { sendBillingEmail } from "@/features/billing/notifications";
import { expireDunning } from "@/features/billing/expire";
import { sendDueOnboardingEmails } from "@/features/onboarding/emails";
import { evaluateAlerts } from "@/features/observability/alerts";
import { runBackupVerification } from "@/features/observability/backups";
import { pruneObservability } from "@/features/observability/prune";
import { runDueSavedReports } from "@/features/reporting/service";
import { publishDueReleases } from "@/features/releases/publisher";
import {
  getSlackUserName,
  postSlackMessage,
  respondToSlackCommand,
  SlackApiError,
} from "@/features/slack/client";
import {
  createRequestFromSlack,
  getSlackIntegrationForEvent,
  markSlackConfirmation,
} from "@/features/slack/service";
import {
  appendSlackSupportReply,
  startSlackSupportThread,
} from "@/features/slack/support";
import { processIssueTrackerEvent } from "@/features/integrations/issue-service";
import { ISSUE_PROVIDERS } from "@/features/integrations/issue-providers";
import {
  enqueueScheduledCrmSyncs,
  syncCrmConnection,
} from "@/features/integrations/crm-service";
import { isSandboxMode } from "@/lib/sandbox";
import { outboundHandlers } from "./outbound-handlers";

import { NonRetryableJobError } from "./errors";
import type { JobHandler, JobType } from "./types";

/**
 * Job type → handler registry.
 *
 * Every value of `job_type` needs an entry: `tests/jobs-handlers.test.ts` fails
 * when the enum holds a type `getJobHandler` cannot resolve. Add the handler in
 * the same change that starts enqueuing the type, and delete a type from the
 * enum (with a migration) once nothing schedules it — an enum value with no
 * handler can only ever be marked failed.
 */

const sendEmailPayload = z.object({ deliveryId: z.uuid() });
const processImportPayload = z.object({ importId: z.uuid() });
const crawlKnowledgePayload = z.object({
  sourceId: z.uuid(),
  versionId: z.uuid(),
});
const junoAnswerPayload = z.object({ conversationId: z.uuid() });
const junoFeedbackSuggestionPayload = z.object({
  productId: z.uuid(),
  feedbackPostId: z.uuid(),
});
const slackMessagePayload = z.object({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  messageTs: z.string().min(1),
  text: z.string().min(1).max(20_000),
  userId: z.string(),
});
const slackStatusPayload = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  threadTs: z.string().min(1),
  text: z.string().min(1).max(10_000),
});
const slackCommandPayload = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1),
  responseUrl: z.url(),
  text: z.string().min(1).max(20_000),
});
const slackSupportPayload = z.object({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  messageTs: z.string().min(1),
  threadTs: z.string().min(1),
  text: z.string().max(20_000),
  userId: z.string(),
  isThreadReply: z.boolean(),
});
const slackSupportMirrorPayload = z.object({
  messageId: z.uuid(),
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  threadTs: z.string().min(1),
  text: z.string().min(1).max(10_000),
});
const issueTrackerEventPayload = z.object({
  connectionId: z.uuid(),
  provider: z.enum(ISSUE_PROVIDERS),
  externalId: z.string().min(1).max(300),
  externalUrl: z.string().max(2_000).nullable(),
  candidates: z.array(z.string().max(300)).max(20),
  eventName: z.string().min(1).max(100),
  actorName: z.string().max(200).nullable(),
  deliveryKey: z.string().min(1).max(500),
});
const crmConnectionPayload = z.object({ connectionId: z.uuid() });
const analyticsPayload = z.object({
  workspaceId: z.uuid().optional(),
  productId: z.uuid().optional(),
  days: z.number().int().min(1).max(90).optional(),
});
const billingEmailPayload = z.object({
  workspaceId: z.uuid(),
  kind: z.enum([
    "trial_ending",
    "payment_failed",
    "dunning_reminder",
    "dunning_final",
    "billing_winback",
  ]),
  noticeKey: z.string().min(1).max(180),
  trialEndsAt: z.string().max(40).optional(),
  invoiceUrl: z.string().max(2_000).optional(),
  amountDue: z.number().int().nonnegative().optional(),
  currency: z.string().min(3).max(3).optional(),
  nextAttemptAt: z.string().max(40).optional(),
  stage: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  graceEndsAt: z.string().max(40).optional(),
  feedbackId: z.uuid().optional(),
});

const expireDunningPayload = z.object({
  workspaceId: z.uuid(),
  graceUntil: z.string().max(40),
});

const handlers: Partial<Record<JobType, JobHandler>> = {
  ...outboundHandlers,

  publish_releases: async () => {
    const result = await publishDueReleases();
    return result as unknown as Record<string, unknown>;
  },

  send_email: async (payload) => {
    const parsed = sendEmailPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("send_email requires a deliveryId.");
    }

    const outcome = await sendNotificationDelivery(parsed.data.deliveryId);
    if (outcome.status === "failed") {
      throw new NonRetryableJobError(outcome.error ?? "Delivery failed.");
    }
    // Quiet-hours deferral is not a provider retry: the row stays pending and
    // the periodic outbox sweep will pick it up after the local window closes.
    if (outcome.deferred) return outcome as unknown as Record<string, unknown>;
    if (outcome.status === "pending") {
      throw new Error(outcome.error ?? "Email provider asked us to retry.");
    }
    return outcome as unknown as Record<string, unknown>;
  },

  deliver_notification: async () => {
    const summary = await deliverPendingEmails(25);
    return summary as unknown as Record<string, unknown>;
  },

  slack_message: async (payload) => {
    const parsed = slackMessagePayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("slack_message requires an event, team and channel.");
    }

    const integration = await getSlackIntegrationForEvent({
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
    });
    if (!integration) return { ignored: "channel_not_connected" };

    const authorName = parsed.data.userId
      ? await getSlackUserName(integration.accessToken, parsed.data.userId).catch(
          () => `Slack user ${parsed.data.userId}`,
        )
      : "Slack member";

    const result = await createRequestFromSlack({
      integration,
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
      messageTs: parsed.data.messageTs,
      text: parsed.data.text,
      authorName,
    });
    if (!result.ok) {
      if (!isSandboxMode()) {
        await postSlackMessage({
          token: integration.accessToken,
          channel: parsed.data.channelId,
          threadTs: parsed.data.messageTs,
          text: `I couldn't file this request: ${result.error}`,
        }).catch(() => {});
      }
      throw new NonRetryableJobError(result.error);
    }

    if (!isSandboxMode() && !result.confirmationTs) {
      try {
        const confirmation = await postSlackMessage({
          token: integration.accessToken,
          channel: parsed.data.channelId,
          threadTs: parsed.data.messageTs,
          text: `<${result.url}|${result.title}> was created on *${result.boardName}* from this message.`,
        });
        await markSlackConfirmation({
          requestId: result.requestId,
          confirmationTs: confirmation.ts,
        });
      } catch (error) {
        if (error instanceof SlackApiError && !error.retryable) {
          throw new NonRetryableJobError(error.message);
        }
        throw error;
      }
    }

    return {
      requestId: result.requestId,
      created: result.created,
      sandbox: isSandboxMode(),
    };
  },

  slack_status_update: async (payload) => {
    const parsed = slackStatusPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("slack_status_update requires a channel and text.");
    }
    const integration = await getSlackIntegrationForEvent({
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
    });
    if (!integration) return { ignored: "channel_not_connected" };
    if (isSandboxMode()) return { skipped: "sandbox" };

    try {
      const posted = await postSlackMessage({
        token: integration.accessToken,
        channel: parsed.data.channelId,
        threadTs: parsed.data.threadTs,
        text: parsed.data.text,
      });
      return { ts: posted.ts };
    } catch (error) {
      if (error instanceof SlackApiError && !error.retryable) {
        throw new NonRetryableJobError(error.message);
      }
      throw error;
    }
  },

  slack_command: async (payload) => {
    const parsed = slackCommandPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("slack_command requires a team, channel and text.");
    }
    const integration = await getSlackIntegrationForEvent({
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
    });
    if (!integration) {
      await respondToSlackCommand({
        responseUrl: parsed.data.responseUrl,
        text: "This channel is no longer connected to Herald.",
      }).catch(() => undefined);
      return { ignored: "channel_not_connected" };
    }

    const authorName = await getSlackUserName(integration.accessToken, parsed.data.userId).catch(
      () => `Slack user ${parsed.data.userId}`,
    );
    const result = await createRequestFromSlack({
      integration,
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
      messageTs: `slash:${parsed.data.userId}:${Date.now()}`,
      text: parsed.data.text,
      authorName,
      linkThread: false,
    });
    if (!result.ok) {
      await respondToSlackCommand({
        responseUrl: parsed.data.responseUrl,
        text: `I couldn't file this request: ${result.error}`,
      }).catch(() => undefined);
      throw new NonRetryableJobError(result.error);
    }

    await respondToSlackCommand({
      responseUrl: parsed.data.responseUrl,
      text: `<${result.url}|${result.title}> was created on *${result.boardName}*.`,
    }).catch(() => undefined);
    return { requestId: result.requestId, created: result.created };
  },

  slack_support_message: async (payload) => {
    const parsed = slackSupportPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError(
        "slack_support_message requires a team, channel and thread.",
      );
    }

    const integration = await getSlackIntegrationForEvent({
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
    });
    if (!integration) return { ignored: "channel_not_connected" };

    const authorName = parsed.data.userId
      ? await getSlackUserName(integration.accessToken, parsed.data.userId).catch(
          () => `Slack user ${parsed.data.userId}`,
        )
      : "Slack member";

    const result = parsed.data.isThreadReply
      ? await appendSlackSupportReply({
          integration,
          teamId: parsed.data.teamId,
          channelId: parsed.data.channelId,
          threadTs: parsed.data.threadTs,
          messageTs: parsed.data.messageTs,
          body: parsed.data.text,
        })
      : await startSlackSupportThread({
          integration,
          teamId: parsed.data.teamId,
          channelId: parsed.data.channelId,
          messageTs: parsed.data.messageTs,
          body: parsed.data.text,
          authorName,
          slackUserId: parsed.data.userId,
        });

    if (result === null) return { ignored: "not_support_thread" };
    if (!result.ok) {
      if (!isSandboxMode()) {
        await postSlackMessage({
          token: integration.accessToken,
          channel: parsed.data.channelId,
          threadTs: parsed.data.threadTs,
          text: result.error,
        }).catch(() => {});
      }
      throw new NonRetryableJobError(result.error);
    }

    if (result.created && !isSandboxMode()) {
      await postSlackMessage({
        token: integration.accessToken,
        channel: parsed.data.channelId,
        threadTs: parsed.data.messageTs,
        text: "Support thread started. Replies here continue the conversation.",
      }).catch(() => {});
    }

    return {
      conversationId: result.conversationId,
      created: result.created,
      duplicate: result.duplicate,
      sandbox: isSandboxMode(),
    };
  },

  slack_support_mirror: async (payload) => {
    const parsed = slackSupportMirrorPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError(
        "slack_support_mirror requires a channel, thread and text.",
      );
    }
    const integration = await getSlackIntegrationForEvent({
      teamId: parsed.data.teamId,
      channelId: parsed.data.channelId,
    });
    if (!integration) return { ignored: "channel_not_connected" };
    if (isSandboxMode()) return { skipped: "sandbox" };

    try {
      const posted = await postSlackMessage({
        token: integration.accessToken,
        channel: parsed.data.channelId,
        threadTs: parsed.data.threadTs,
        text: parsed.data.text,
      });
      return { ts: posted.ts, messageId: parsed.data.messageId };
    } catch (error) {
      if (error instanceof SlackApiError && !error.retryable) {
        throw new NonRetryableJobError(error.message);
      }
      throw error;
    }
  },

  send_weekly_digest: async () => {
    // The job name is kept for queue compatibility; it now queues both the
    // daily and weekly cadences, each with its own period dedupe key.
    const summary = await enqueueDueDigests();
    return summary as unknown as Record<string, unknown>;
  },

  issue_tracker_event: async (payload) => {
    const parsed = issueTrackerEventPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("issue_tracker_event has an invalid payload.");
    }
    const result = await processIssueTrackerEvent(parsed.data);
    return result as unknown as Record<string, unknown>;
  },

  sync_crm_connection: async (payload) => {
    const parsed = crmConnectionPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("sync_crm_connection requires a connectionId.");
    }
    const result = await syncCrmConnection(parsed.data.connectionId);
    return result as unknown as Record<string, unknown>;
  },

  schedule_crm_sync: async () => {
    const result = await enqueueScheduledCrmSyncs();
    return result as unknown as Record<string, unknown>;
  },

  process_import: async (payload) => {
    const parsed = processImportPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("process_import requires an importId.");
    }

    const result = await processFeedbackImport(parsed.data.importId);
    return result as unknown as Record<string, unknown>;
  },

  crawl_knowledge: async (payload) => {
    const parsed = crawlKnowledgePayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("crawl_knowledge requires a source and version.");
    }

    const result = await runKnowledgeCrawl(parsed.data);
    return result as unknown as Record<string, unknown>;
  },

  juno_answer: async (payload) => {
    const parsed = junoAnswerPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("juno_answer requires a conversationId.");
    }

    const rows = await db
      .select({ productId: conversations.productId })
      .from(conversations)
      .where(eq(conversations.id, parsed.data.conversationId))
      .limit(1);
    const conversation = rows[0];
    if (!conversation) {
      throw new NonRetryableJobError("That conversation no longer exists.");
    }

    const outcome = await answerConversation({
      conversationId: parsed.data.conversationId,
      productId: conversation.productId,
    });
    return outcome as unknown as Record<string, unknown>;
  },

  juno_auto_resolve: async () => {
    const result = await sweepJunoAutoResolve();
    return result as unknown as Record<string, unknown>;
  },

  juno_tag_feedback: async (payload) => {
    const parsed = junoFeedbackSuggestionPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError(
        "juno_tag_feedback requires a product and a feedback request.",
      );
    }
    const result = await suggestTagsForPost(parsed.data);
    return result as unknown as Record<string, unknown>;
  },

  juno_duplicate_suggestions: async (payload) => {
    const parsed = junoFeedbackSuggestionPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError(
        "juno_duplicate_suggestions requires a product and a feedback request.",
      );
    }
    const result = await suggestDuplicatesForPost(parsed.data);
    return result as unknown as Record<string, unknown>;
  },

  export_saved_reports: async () => {
    const summary = await runDueSavedReports();
    return summary as unknown as Record<string, unknown>;
  },

  recalculate_analytics: async (payload) => {
    const parsed = analyticsPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("recalculate_analytics has an invalid payload.");
    }
    if (parsed.data.workspaceId && parsed.data.productId) {
      await recalculateAnalyticsWindow({
        workspaceId: parsed.data.workspaceId,
        productId: parsed.data.productId,
        days: parsed.data.days ?? 2,
      });
      return { recalculated: 1 };
    }
    return recalculateAnalyticsForAllProducts({ days: parsed.data.days ?? 2 });
  },

  purge_workspaces: async () => {
    return purgeDueWorkspaces();
  },

  prune_audit_events: async () => {
    const [audit, signupFunnel] = await Promise.all([
      pruneAuditEvents(),
      pruneSignupFunnelEvents(),
    ]);
    return { ...audit, signupFunnel: signupFunnel.pruned };
  },

  send_onboarding_emails: async () => {
    const summary = await sendDueOnboardingEmails({ limit: 25 });
    if (summary.failed > 0) {
      throw new Error(
        `${summary.failed} onboarding email${summary.failed === 1 ? "" : "s"} failed; retrying.`,
      );
    }
    return summary as unknown as Record<string, unknown>;
  },

  send_billing_email: async (payload) => {
    const parsed = billingEmailPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("send_billing_email has an invalid payload.");
    }
    const result = await sendBillingEmail(parsed.data);
    const retryable = result.failures.find((failure) => failure.retryable);
    if (retryable) throw new Error(retryable.error);
    const failed = result.failures[0];
    if (failed) throw new NonRetryableJobError(failed.error);
    return result as unknown as Record<string, unknown>;
  },

  expire_dunning: async (payload) => {
    const parsed = expireDunningPayload.safeParse(payload);
    if (!parsed.success) {
      throw new NonRetryableJobError("expire_dunning has an invalid payload.");
    }
    return (await expireDunning(parsed.data)) as unknown as Record<string, unknown>;
  },

  evaluate_alerts: async () => {
    const readings = await evaluateAlerts();
    return {
      evaluated: readings.length,
      firing: readings.filter((reading) => reading.state === "firing").length,
    };
  },

  verify_backups: async () => {
    const result = await runBackupVerification();
    return { ...result };
  },

  prune_observability: async () => {
    return (await pruneObservability()) as unknown as Record<string, unknown>;
  },
};

export function getJobHandler(type: JobType): JobHandler | null {
  return handlers[type] ?? null;
}
