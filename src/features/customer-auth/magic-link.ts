import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { customerLoginTokens, customers, workspaces } from "@/db/schema";
import {
  createCustomerSession,
  mergeGuestCustomer,
  revokeCustomerSession,
  verifyGuestCustomerEmail,
  type ActiveCustomerSession,
} from "@/features/customer-session/session";
import { createSessionToken, hashSessionToken } from "@/features/customer-session/token";
import { renderCustomerMagicLinkEmail } from "@/features/email/templates";
import { sendEmail } from "@/features/email/provider";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { getEmailConfig, getServerEnv } from "@/lib/env";
import { isValidEmail, normalizeEmail } from "@/lib/email";

import { sanitizeNextPath } from "./next-path";

/**
 * Customer magic-link sign-in.
 *
 * Requesting a link never reveals whether the address has an account: a new
 * customer is created only when the link is consumed. Tokens are random,
 * stored as a hash, single-use, and expire after fifteen minutes. Consuming a
 * link invalidates every other outstanding link for that address.
 */

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type MagicLinkRequestResult =
  | { ok: true }
  | { ok: false; status: 400 | 502 | 503; error: string };

export async function requestMagicLink(input: {
  workspace: { id: string; name: string; slug: string };
  productName: string;
  email: string;
  nextPath: string | null;
}): Promise<MagicLinkRequestResult> {
  const email = input.email.trim();
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }

  let emailConfigured = false;
  try {
    emailConfigured = getEmailConfig() !== null;
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Sign-in email is not configured for this deployment.",
    };
  }
  if (!emailConfigured) {
    return {
      ok: false,
      status: 503,
      error: "Sign-in email is not configured for this deployment.",
    };
  }

  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);

  const rows = await db
    .insert(customerLoginTokens)
    .values({
      workspaceId: input.workspace.id,
      email,
      emailNormalized: normalizeEmail(email),
      tokenHash: token.tokenHash,
      nextPath: sanitizeNextPath(input.nextPath),
      expiresAt,
    })
    .returning({ id: customerLoginTokens.id });

  const row = rows[0];
  if (!row) {
    return { ok: false, status: 502, error: "Could not create a sign-in link." };
  }

  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  const url = `${origin}/api/public/auth/magic-link/verify?token=${encodeURIComponent(
    token.token,
  )}`;

  const rendered = renderCustomerMagicLinkEmail({
    workspaceName: input.workspace.name,
    productName: input.productName,
    url,
    expiresMinutes: MAGIC_LINK_TTL_MS / 60_000,
  });

  const sent = await sendEmail({ to: email, ...rendered });
  if (!sent.ok) {
    await db
      .delete(customerLoginTokens)
      .where(eq(customerLoginTokens.id, row.id))
      .catch(() => {});
    return {
      ok: false,
      status: 502,
      error: "Could not send the sign-in email. Please try again.",
    };
  }

  return { ok: true };
}

export type MagicLinkConsumeResult =
  | {
      ok: true;
      workspace: { id: string; name: string; slug: string };
      customerId: string;
      cookieValue: string;
      nextPath: string | null;
    }
  | { ok: false; reason: "invalid" | "banned" | "closed" };

export async function consumeMagicLink(input: {
  token: string;
  activeSession: ActiveCustomerSession | null;
  now?: Date;
}): Promise<MagicLinkConsumeResult> {
  const token = input.token.trim();
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid" };

  const now = input.now ?? new Date();
  const tokenHash = hashSessionToken(token);

  const rows = await db
    .select()
    .from(customerLoginTokens)
    .where(
      and(
        eq(customerLoginTokens.tokenHash, tokenHash),
        isNull(customerLoginTokens.usedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid" };
  }

  // Claim the token atomically. A second click on the same link finds no row
  // to update and is rejected instead of consuming it twice.
  const claimed = await db
    .update(customerLoginTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(customerLoginTokens.id, row.id),
        isNull(customerLoginTokens.usedAt),
      ),
    )
    .returning({ id: customerLoginTokens.id });
  if (!claimed[0]) return { ok: false, reason: "invalid" };

  const workspaceRows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      plan: workspaces.plan,
    })
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);
  const workspace = workspaceRows[0];
  if (!workspace || !publicSurfaceEnabled(workspace.plan)) {
    return { ok: false, reason: "closed" };
  }

  await db
    .update(customerLoginTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(customerLoginTokens.workspaceId, row.workspaceId),
        eq(customerLoginTokens.emailNormalized, row.emailNormalized),
        isNull(customerLoginTokens.usedAt),
      ),
    );

  const existingRows = await db
    .select({ id: customers.id, bannedAt: customers.bannedAt })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, row.workspaceId),
        eq(customers.emailNormalized, row.emailNormalized),
      ),
    )
    .limit(1);
  const existing = existingRows[0] ?? null;
  if (existing?.bannedAt) return { ok: false, reason: "banned" };

  const active =
    input.activeSession?.session.workspaceId === row.workspaceId
      ? input.activeSession
      : null;

  let customerId: string | null = null;

  if (existing) {
    customerId = existing.id;
    if (
      active &&
      active.session.guest &&
      active.customer.id !== existing.id
    ) {
      await mergeGuestCustomer({
        guestCustomerId: active.customer.id,
        targetCustomerId: existing.id,
        workspaceId: row.workspaceId,
      });
    }
  } else if (
    active &&
    active.session.guest &&
    (active.customer.email === null ||
      normalizeEmail(active.customer.email) === row.emailNormalized)
  ) {
    await verifyGuestCustomerEmail({
      customerId: active.customer.id,
      email: row.email,
      name: active.customer.name,
    });
    customerId = active.customer.id;
  } else {
    const inserted = await db
      .insert(customers)
      .values({
        workspaceId: row.workspaceId,
        email: row.email,
        emailNormalized: row.emailNormalized,
        verifiedAt: now,
        lastSeenAt: now,
      })
      .returning({ id: customers.id });
    const created = inserted[0];
    if (!created) return { ok: false, reason: "invalid" };
    customerId = created.id;
  }

  if (!customerId) return { ok: false, reason: "invalid" };

  if (active) {
    await revokeCustomerSession(active.session.id).catch(() => {});
  }

  const session = await createCustomerSession({
    workspaceId: row.workspaceId,
    customerId,
  });
  if (!session) return { ok: false, reason: "banned" };

  return {
    ok: true,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },
    customerId,
    cookieValue: session.cookieValue,
    nextPath: sanitizeNextPath(row.nextPath),
  };
}

