import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { subscribers } from "@/db/schema/subscribers";
import { products, workspaces } from "@/db/schema/workspaces";
import { isEmailSuppressed } from "@/features/email/suppressions";
import { sendEmail } from "@/features/email/provider";
import { renderSubscriberConfirmationEmail } from "@/features/email/templates";
import { publicConfirmPath } from "@/features/public/paths";
import { getServerEnv } from "@/lib/env";
import { isSandboxMode } from "@/lib/sandbox";

import { createPreferenceToken, isPreferenceToken } from "./preferences";

/**
 * Double opt-in.
 *
 * A subscriber created while the workspace setting is on stays `pending`
 * until the address owner opens the confirmation link. The token is random,
 * single-use and grants nothing except confirming that one subscriber row.
 */

export type ConfirmationSendResult =
  | { ok: true; skipped?: "sandbox" | "suppressed" | "already_confirmed" }
  | { ok: false; error: string };

export type ConfirmResult =
  | {
      state: "confirmed" | "already";
      workspaceSlug: string;
      productSlug: string;
      email: string;
    }
  | { state: "invalid" };

const SELECTION = {
  id: subscribers.id,
  productId: subscribers.productId,
  email: subscribers.email,
  status: subscribers.status,
  confirmationToken: subscribers.confirmationToken,
  workspaceName: workspaces.name,
  workspaceSlug: workspaces.slug,
  productName: products.name,
  productSlug: products.slug,
} as const;

async function loadSubscriber(subscriberId: string, productId: string) {
  const rows = await db
    .select(SELECTION)
    .from(subscribers)
    .innerJoin(products, eq(subscribers.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(and(eq(subscribers.id, subscriberId), eq(subscribers.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Create or reuse the confirmation token, then send the link. */
export async function sendSubscriberConfirmation(input: {
  workspaceId: string;
  productId: string;
  subscriberId: string;
}): Promise<ConfirmationSendResult> {
  const row = await loadSubscriber(input.subscriberId, input.productId);
  if (!row) return { ok: false, error: "That subscriber no longer exists." };
  if (row.status === "active") return { ok: true, skipped: "already_confirmed" };

  if (isSandboxMode()) return { ok: true, skipped: "sandbox" };
  if (await isEmailSuppressed(input.workspaceId, row.email)) {
    return { ok: true, skipped: "suppressed" };
  }

  const token = row.confirmationToken ?? createPreferenceToken();
  const now = new Date();
  await db
    .update(subscribers)
    .set({
      confirmationToken: token,
      confirmationSentAt: now,
      updatedAt: now,
    })
    .where(and(eq(subscribers.id, row.id), eq(subscribers.productId, row.productId)));

  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  const confirmUrl = `${origin}${publicConfirmPath(
    row.workspaceSlug,
    row.productSlug,
    token,
  )}`;

  const rendered = renderSubscriberConfirmationEmail({
    workspaceName: row.workspaceName,
    productName: row.productName,
    email: row.email,
    confirmUrl,
  });
  const sent = await sendEmail({ to: row.email, ...rendered });
  if (!sent.ok) {
    return { ok: false, error: sent.error ?? "Could not send the confirmation email." };
  }
  return { ok: true };
}

/** Consume a confirmation token. A replay reports `already`, not a second opt-in. */
export async function confirmSubscriber(token: string): Promise<ConfirmResult> {
  if (!isPreferenceToken(token)) return { state: "invalid" };

  const rows = await db
    .select(SELECTION)
    .from(subscribers)
    .innerJoin(products, eq(subscribers.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(eq(subscribers.confirmationToken, token))
    .limit(1);
  const row = rows[0];
  if (!row) return { state: "invalid" };

  if (row.status === "active") {
    await db
      .update(subscribers)
      .set({ confirmationToken: null, updatedAt: new Date() })
      .where(eq(subscribers.id, row.id));
    return {
      state: "already",
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      email: row.email,
    };
  }

  const now = new Date();
  await db
    .update(subscribers)
    .set({
      status: "active",
      confirmedAt: now,
      confirmationToken: null,
      unsubscribedAt: null,
      updatedAt: now,
    })
    .where(eq(subscribers.id, row.id));

  return {
    state: "confirmed",
    workspaceSlug: row.workspaceSlug,
    productSlug: row.productSlug,
    email: row.email,
  };
}
