"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema/notifications";
import { consumeRateLimit } from "@/features/customer-session/rate-limit";
import { enqueueJob } from "@/features/jobs/queue";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { isValidEmail } from "@/lib/email";

import { saveSenderIdentity } from "./identity";
import { sendTestEmail } from "./send";
import { sendSenderVerification } from "./verification";

function revalidateSettings(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}/settings`);
}

const testSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  /** Comma, semicolon, tab or newline separated; de-duplicated server-side. */
  to: z.string().trim().min(3).max(2_000),
  mode: z.enum(["test", "customer"]).optional(),
});

const MAX_TEST_RECIPIENTS = 5;

function parseTestRecipients(value: string): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const part of value.split(/[\s,;]+/)) {
    const email = part.trim();
    if (!email || !isValidEmail(email)) return [];
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(email);
  }
  return recipients;
}

/**
 * Send one test email to an address the operator chooses.
 *
 * Requires `settings:manage` and is rate-limited per user. The response carries
 * the provider message id; nothing about the API key or provider request is
 * returned.
 */
export async function saveSenderIdentityAction(input: unknown): Promise<
  ActionResult<{
    configured: true;
    verificationSentTo: string[];
    verificationError: string | null;
  }>
> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      fromName: z.string().trim().min(2).max(120),
      fromEmail: z.string().trim().min(3).max(254),
      replyTo: z.string().trim().max(254).optional(),
      postalAddress: z.string().trim().min(10).max(500),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the sender identity." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await saveSenderIdentity({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    fromName: parsed.data.fromName,
    fromEmail: parsed.data.fromEmail,
    replyTo: parsed.data.replyTo ?? null,
    postalAddress: parsed.data.postalAddress,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "email.identity_saved",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
  });

  const verificationSentTo: string[] = [];
  let verificationError: string | null = null;
  for (const request of result.verificationRequests) {
    const limit = await consumeRateLimit({
      bucket: `email-verify:${authorized.context.workspace.id}:${request.purpose}`,
      limit: 3,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      verificationError ??= "Too many verification emails. Try again later.";
      continue;
    }
    const sent = await sendSenderVerification({
      workspaceId: authorized.context.workspace.id,
      purpose: request.purpose,
    });
    if (sent.ok) verificationSentTo.push(sent.address);
    else verificationError ??= sent.error;
  }

  revalidateSettings(parsed.data.workspaceSlug, parsed.data.productSlug);
  return {
    ok: true,
    data: { configured: true, verificationSentTo, verificationError },
  };
}

export async function resendSenderVerificationAction(
  input: unknown,
): Promise<ActionResult<{ address: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      purpose: z.enum(["from", "reply_to"]),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose an address to verify." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const limit = await consumeRateLimit({
    bucket: `email-verify:${authorized.context.workspace.id}:${parsed.data.purpose}`,
    limit: 3,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return { ok: false, error: "Too many verification emails. Try again later." };
  }

  const result = await sendSenderVerification({
    workspaceId: authorized.context.workspace.id,
    purpose: parsed.data.purpose,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { address: result.address } };
}

export async function sendTestEmailAction(
  input: unknown,
): Promise<
  ActionResult<{
    providerMessageId: string | null;
    recipients: string[];
    failures: { email: string; error: string }[];
  }>
> {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter one or more valid email addresses." };
  }
  const recipients = parseTestRecipients(parsed.data.to);
  if (recipients.length === 0) {
    return { ok: false, error: "Enter one or more valid email addresses." };
  }
  if (recipients.length > MAX_TEST_RECIPIENTS) {
    return {
      ok: false,
      error: `Send a test to at most ${MAX_TEST_RECIPIENTS} addresses at a time.`,
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const { workspace, product, user } = authorized.context;

  const limit = await consumeRateLimit({
    bucket: `email-test:${user.id}`,
    limit: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return { ok: false, error: "Too many test emails. Please try again in a minute." };
  }

  const failures: { email: string; error: string }[] = [];
  let providerMessageId: string | null = null;
  for (const recipient of recipients) {
    try {
      const result = await sendTestEmail({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        productName: product.name,
        productSlug: product.slug,
        to: recipient,
        mode: parsed.data.mode,
      });
      if (result.ok) providerMessageId ??= result.providerMessageId;
      else failures.push({ email: recipient, error: result.error });
    } catch (error) {
      console.error("[email] test send failed", error);
      failures.push({ email: recipient, error: "Could not send this test email." });
    }
  }

  if (failures.length === recipients.length) {
    return { ok: false, error: failures[0]?.error ?? "Could not send the test email." };
  }
  return {
    ok: true,
    data: {
      providerMessageId,
      recipients: recipients.filter(
        (email) => !failures.some((failure) => failure.email === email),
      ),
      failures,
    },
  };
}

export async function retryDeliveryAction(
  input: unknown,
): Promise<ActionResult<{ deliveryId: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      deliveryId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose a failed delivery to retry." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const { workspace, product, user } = authorized.context;
  const updated = await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      attemptCount: 0,
      providerMessageId: null,
      sentAt: null,
      deferUntil: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationDeliveries.id, parsed.data.deliveryId),
        eq(notificationDeliveries.productId, product.id),
        eq(notificationDeliveries.workspaceId, workspace.id),
        inArray(notificationDeliveries.status, [
          "failed",
          "bounced",
          "complained",
          "skipped",
        ]),
      ),
    )
    .returning({ id: notificationDeliveries.id });

  if (!updated[0]) {
    return { ok: false, error: "Only a failed, bounced, complaint or skipped delivery can be retried." };
  }

  await enqueueJob({
    type: "send_email",
    payload: { deliveryId: parsed.data.deliveryId },
    dedupeKey: `send_email:${parsed.data.deliveryId}:retry:${Date.now()}`,
  });
  await recordWorkspaceAudit({
    workspaceId: workspace.id,
    actorUserId: user.id,
    action: "email.delivery_retried",
    targetType: "notification_delivery",
    targetId: parsed.data.deliveryId,
  });
  revalidateSettings(parsed.data.workspaceSlug, parsed.data.productSlug);
  return { ok: true, data: { deliveryId: parsed.data.deliveryId } };
}
