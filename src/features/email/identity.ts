import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceEmailIdentities } from "@/db/schema/email";
import { workspaces } from "@/db/schema/workspaces";
import { isValidEmail } from "@/lib/email";
import { getEmailConfig } from "@/lib/env";

/**
 * The identity a workspace sends lifecycle and campaign email as.
 *
 * A configured row is authoritative. The deployment-level EMAIL_FROM is only a
 * read-only fallback so existing transactional mail keeps working; campaigns
 * require the workspace-specific row because they also need a postal address
 * and a reply-to that belongs to the workspace.
 */

export type SenderIdentity = {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  postalAddress: string;
  configured: boolean;
  from: string;
  fromVerifiedAt: Date | null;
  replyToVerifiedAt: Date | null;
};

const EMAIL_IN_ANGLE_BRACKETS = /^(.*?)\s*<([^>]+)>\s*$/;

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function parseConfiguredFrom(value: string): { name: string; email: string } {
  const match = EMAIL_IN_ANGLE_BRACKETS.exec(value.trim());
  if (match) {
    return { name: clean(match[1] ?? ""), email: clean(match[2] ?? "") };
  }
  return { name: "", email: clean(value) };
}

export function formatSender(fromName: string, fromEmail: string): string {
  const name = clean(fromName).replaceAll('"', "");
  return name === "" ? fromEmail : `${name} <${fromEmail}>`;
}

/**
 * Read the identity without throwing when the deployment email pair is
 * malformed. Settings must still render so an operator can fix the workspace
 * values; sending is where a malformed deployment config becomes an error.
 */
export async function getSenderIdentity(workspaceId: string): Promise<SenderIdentity> {
  const rows = await db
    .select({
      identity: workspaceEmailIdentities,
      workspaceName: workspaces.name,
    })
    .from(workspaces)
    .leftJoin(
      workspaceEmailIdentities,
      eq(workspaceEmailIdentities.workspaceId, workspaces.id),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      fromName: "",
      fromEmail: "",
      replyTo: null,
      postalAddress: "",
      configured: false,
      from: "",
      fromVerifiedAt: null,
      replyToVerifiedAt: null,
    };
  }

  if (row.identity) {
    return {
      fromName: row.identity.fromName,
      fromEmail: row.identity.fromEmail,
      replyTo: row.identity.replyTo,
      postalAddress: row.identity.postalAddress,
      configured: true,
      from: formatSender(row.identity.fromName, row.identity.fromEmail),
      fromVerifiedAt: row.identity.fromVerifiedAt,
      replyToVerifiedAt: row.identity.replyToVerifiedAt,
    };
  }

  try {
    const config = getEmailConfig();
    if (!config) throw new Error("unset");
    const parsed = parseConfiguredFrom(config.EMAIL_FROM);
    return {
      fromName: parsed.name || row.workspaceName,
      fromEmail: parsed.email,
      replyTo: null,
      postalAddress: "",
      configured: false,
      from: config.EMAIL_FROM,
      fromVerifiedAt: null,
      replyToVerifiedAt: null,
    };
  } catch {
    return {
      fromName: row.workspaceName,
      fromEmail: "",
      replyTo: null,
      postalAddress: "",
      configured: false,
      from: "",
      fromVerifiedAt: null,
      replyToVerifiedAt: null,
    };
  }
}

/** A campaign may only be approved or sent when this returns null. */
export function senderIdentityProblem(identity: SenderIdentity): string | null {
  if (!identity.configured) {
    return "Set the workspace sender identity before sending a campaign.";
  }
  if (!isValidEmail(identity.fromEmail)) {
    return "The sender email address is not valid.";
  }
  if (!identity.fromVerifiedAt) {
    return "Verify the From address before sending a campaign. Open the verification email sent to that mailbox.";
  }
  if (identity.fromName.trim() === "") {
    return "Add the sender name customers should see.";
  }
  if (identity.postalAddress.trim().length < 10) {
    return "Add the physical mailing address required in campaign email.";
  }
  if (identity.replyTo !== null && !isValidEmail(identity.replyTo)) {
    return "The reply-to address is not valid.";
  }
  if (identity.replyTo !== null && !identity.replyToVerifiedAt) {
    return "Verify the reply-to address before sending a campaign. Open the verification email sent to that mailbox.";
  }
  return null;
}

export type SaveSenderIdentityResult =
  | {
      ok: true;
      identity: SenderIdentity;
      /** Addresses that need a fresh verification email after this save. */
      verificationRequests: Array<{ purpose: "from" | "reply_to"; address: string }>;
    }
  | { ok: false; error: string };

export async function saveSenderIdentity(input: {
  workspaceId: string;
  actorUserId: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  postalAddress: string;
}): Promise<SaveSenderIdentityResult> {
  const fromName = clean(input.fromName).slice(0, 120);
  const fromEmail = clean(input.fromEmail).toLowerCase().slice(0, 254);
  const replyToRaw = clean(input.replyTo ?? "").toLowerCase().slice(0, 254);
  const postalAddress = clean(input.postalAddress).slice(0, 500);

  if (fromName.length < 2) return { ok: false, error: "Use at least two characters for the sender name." };
  if (!isValidEmail(fromEmail)) return { ok: false, error: "Enter a valid sender email address." };
  if (replyToRaw !== "" && !isValidEmail(replyToRaw)) {
    return { ok: false, error: "Enter a valid reply-to address, or leave it blank." };
  }
  if (postalAddress.length < 10) {
    return { ok: false, error: "Add the physical mailing address required in campaign email." };
  }

  const now = new Date();
  const nextReplyTo = replyToRaw === "" ? null : replyToRaw;
  const existingRows = await db
    .select({
      fromEmail: workspaceEmailIdentities.fromEmail,
      replyTo: workspaceEmailIdentities.replyTo,
      fromVerifiedAt: workspaceEmailIdentities.fromVerifiedAt,
      replyToVerifiedAt: workspaceEmailIdentities.replyToVerifiedAt,
    })
    .from(workspaceEmailIdentities)
    .where(eq(workspaceEmailIdentities.workspaceId, input.workspaceId))
    .limit(1);
  const existing = existingRows[0] ?? null;
  const fromChanged = existing?.fromEmail !== fromEmail;
  const replyToChanged = (existing?.replyTo ?? null) !== nextReplyTo;
  const fromVerifiedAt = fromChanged ? null : (existing?.fromVerifiedAt ?? null);
  const replyToVerifiedAt = replyToChanged
    ? null
    : (existing?.replyToVerifiedAt ?? null);

  await db
    .insert(workspaceEmailIdentities)
    .values({
      workspaceId: input.workspaceId,
      fromName,
      fromEmail,
      replyTo: nextReplyTo,
      postalAddress,
      fromVerifiedAt,
      replyToVerifiedAt,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceEmailIdentities.workspaceId,
      set: {
        fromName,
        fromEmail,
        replyTo: nextReplyTo,
        postalAddress,
        fromVerifiedAt,
        replyToVerifiedAt,
        updatedBy: input.actorUserId,
        updatedAt: now,
      },
    });

  const verificationRequests: Array<{
    purpose: "from" | "reply_to";
    address: string;
  }> = [];
  if (fromChanged && !fromVerifiedAt) {
    verificationRequests.push({ purpose: "from", address: fromEmail });
  }
  if (replyToChanged && nextReplyTo && !replyToVerifiedAt) {
    verificationRequests.push({ purpose: "reply_to", address: nextReplyTo });
  }

  return {
    ok: true,
    identity: {
      fromName,
      fromEmail,
      replyTo: nextReplyTo,
      postalAddress,
      configured: true,
      from: formatSender(fromName, fromEmail),
      fromVerifiedAt,
      replyToVerifiedAt,
    },
    verificationRequests,
  };
}
