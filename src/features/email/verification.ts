import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  emailIdentityVerifications,
  workspaceEmailIdentities,
} from "@/db/schema/email";
import { workspaces } from "@/db/schema/workspaces";
import { getServerEnv } from "@/lib/env";
import { isValidEmail } from "@/lib/email";

import { sendEmail } from "./provider";
import { renderSenderVerificationEmail } from "./templates";
import {
  SENDER_VERIFICATION_TTL_MS,
  createSenderVerificationToken,
  hashSenderVerificationToken,
  isSenderVerificationToken,
  type SenderVerificationPurpose,
} from "./verification-token";

/**
 * Verify that the operator can receive mail at the From or Reply-To mailbox.
 *
 * A token is random, stored only as a SHA-256 hash, scoped to one workspace,
 * purpose and address, and consumed in a transaction. Changing the saved
 * address invalidates earlier tokens because the address no longer matches.
 */

export type SendSenderVerificationResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

export async function sendSenderVerification(input: {
  workspaceId: string;
  purpose: SenderVerificationPurpose;
  now?: Date;
}): Promise<SendSenderVerificationResult> {
  const rows = await db
    .select({
      workspaceName: workspaces.name,
      fromEmail: workspaceEmailIdentities.fromEmail,
      replyTo: workspaceEmailIdentities.replyTo,
    })
    .from(workspaces)
    .leftJoin(
      workspaceEmailIdentities,
      eq(workspaceEmailIdentities.workspaceId, workspaces.id),
    )
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "Workspace not found." };

  const address =
    input.purpose === "from" ? (row.fromEmail ?? "") : (row.replyTo ?? "");
  if (!isValidEmail(address)) {
    return {
      ok: false,
      error:
        input.purpose === "from"
          ? "Save a valid From address first."
          : "Save a valid reply-to address first.",
    };
  }

  const now = input.now ?? new Date();
  const token = createSenderVerificationToken();
  const tokenHash = hashSenderVerificationToken(token);
  const expiresAt = new Date(now.getTime() + SENDER_VERIFICATION_TTL_MS);

  // Only one live token per purpose; an older email must not verify a newer
  // address, and resending should not leave several usable links.
  await db
    .delete(emailIdentityVerifications)
    .where(
      and(
        eq(emailIdentityVerifications.workspaceId, input.workspaceId),
        eq(emailIdentityVerifications.purpose, input.purpose),
      ),
    );
  await db.insert(emailIdentityVerifications).values({
    workspaceId: input.workspaceId,
    purpose: input.purpose,
    address,
    tokenHash,
    expiresAt,
    createdAt: now,
  });

  const url = new URL("/email/verify", getServerEnv().BETTER_AUTH_URL);
  url.searchParams.set("token", token);
  const rendered = renderSenderVerificationEmail({
    workspaceName: row.workspaceName,
    address,
    purpose: input.purpose,
    url: url.toString(),
    expiresMinutes: Math.round(SENDER_VERIFICATION_TTL_MS / 60_000),
  });

  const result = await sendEmail({ to: address, ...rendered });
  if (!result.ok) {
    await db
      .delete(emailIdentityVerifications)
      .where(eq(emailIdentityVerifications.tokenHash, tokenHash));
    return { ok: false, error: result.error };
  }

  return { ok: true, address };
}

export type ConsumeSenderVerificationResult =
  | { ok: true; purpose: SenderVerificationPurpose }
  | { ok: false; error: string };

export async function consumeSenderVerification(
  token: string,
  now = new Date(),
): Promise<ConsumeSenderVerificationResult> {
  if (!isSenderVerificationToken(token)) {
    return { ok: false, error: "This verification link is not valid." };
  }
  const tokenHash = hashSenderVerificationToken(token);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: emailIdentityVerifications.id,
        workspaceId: emailIdentityVerifications.workspaceId,
        purpose: emailIdentityVerifications.purpose,
        address: emailIdentityVerifications.address,
        expiresAt: emailIdentityVerifications.expiresAt,
        usedAt: emailIdentityVerifications.usedAt,
        fromEmail: workspaceEmailIdentities.fromEmail,
        replyTo: workspaceEmailIdentities.replyTo,
      })
      .from(emailIdentityVerifications)
      .innerJoin(
        workspaceEmailIdentities,
        eq(
          workspaceEmailIdentities.workspaceId,
          emailIdentityVerifications.workspaceId,
        ),
      )
      .where(eq(emailIdentityVerifications.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, error: "This verification link is not valid." };
    }
    if (
      (row.purpose === "from" && row.fromEmail !== row.address) ||
      (row.purpose === "reply_to" && row.replyTo !== row.address)
    ) {
      return { ok: false, error: "This verification link is not valid." };
    }

    const claimed = await tx
      .update(emailIdentityVerifications)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailIdentityVerifications.id, row.id),
          isNull(emailIdentityVerifications.usedAt),
        ),
      )
      .returning({ id: emailIdentityVerifications.id });
    if (!claimed[0]) {
      return { ok: false, error: "This verification link is not valid." };
    }

    const addressColumn =
      row.purpose === "from"
        ? workspaceEmailIdentities.fromEmail
        : workspaceEmailIdentities.replyTo;
    const updated = await tx
      .update(workspaceEmailIdentities)
      .set(
        row.purpose === "from"
          ? { fromVerifiedAt: now, updatedAt: now }
          : { replyToVerifiedAt: now, updatedAt: now },
      )
      .where(
        and(
          eq(workspaceEmailIdentities.workspaceId, row.workspaceId),
          eq(addressColumn, row.address),
        ),
      )
      .returning({ workspaceId: workspaceEmailIdentities.workspaceId });
    if (!updated[0]) {
      return { ok: false, error: "This verification link is not valid." };
    }

    return { ok: true, purpose: row.purpose };
  });
}
