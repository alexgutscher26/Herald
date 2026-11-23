import "server-only";

import { resolveTxt as dnsResolveTxt } from "node:dns/promises";
import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceDomainClaims } from "@/db/schema/domain-claims";

import {
  normalizeEmailDomain,
  type CapturedDomainRole,
} from "./domain-capture";

/**
 * Domain capture claims: storage and DNS verification.
 *
 * A claim is not active because an owner typed a domain. It becomes active only
 * when the TXT challenge at `_herald-claim.<domain>` contains the stored token,
 * which is the only thing that proves the claimant controls the domain. Until
 * then `status` stays `pending` and no sign-up is captured.
 */

const TXT_PREFIX = "_herald-claim.";
const CLAIM_ROLES: readonly CapturedDomainRole[] = ["editor", "viewer"];

export type DomainClaimView = {
  id: string;
  domain: string;
  role: CapturedDomainRole;
  status: "pending" | "verified";
  verificationToken: string;
  txtRecordName: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
};

type LookupTxt = (hostname: string) => Promise<string[][]>;

/**
 * The Postgres unique-violation check, through the driver's error wrapping.
 *
 * Drizzle re-throws a `DrizzleQueryError` whose `cause` is the `pg` error, so
 * looking at `error.code` alone would miss it and turn a duplicate domain into a
 * 500 instead of the message an owner can act on.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  return false;
}

function toView(row: typeof workspaceDomainClaims.$inferSelect): DomainClaimView {
  return {
    id: row.id,
    domain: row.domain,
    role: row.role === "viewer" ? "viewer" : "editor",
    status: row.status === "verified" ? "verified" : "pending",
    verificationToken: row.verificationToken,
    txtRecordName: `${TXT_PREFIX}${row.domain}`,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

export async function getDomainClaim(
  workspaceId: string,
): Promise<DomainClaimView | null> {
  const rows = await db
    .select()
    .from(workspaceDomainClaims)
    .where(eq(workspaceDomainClaims.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function saveDomainClaim(input: {
  workspaceId: string;
  domain: string;
  role: CapturedDomainRole;
  createdBy: string;
}): Promise<{ ok: true; claim: DomainClaimView } | { ok: false; error: string }> {
  if (!CLAIM_ROLES.includes(input.role)) {
    return { ok: false, error: "A capture can only add editors or free viewers." };
  }

  const domain = normalizeEmailDomain(input.domain);
  if (!domain) {
    return {
      ok: false,
      error:
        "Enter a company domain such as acme.com. Public mailbox providers (gmail.com and similar) cannot be claimed.",
    };
  }

  const token = `herald-claim-${randomBytes(18).toString("hex")}`;
  try {
    const rows = await db
      .insert(workspaceDomainClaims)
      .values({
        workspaceId: input.workspaceId,
        domain,
        role: input.role,
        verificationToken: token,
        status: "pending",
        createdBy: input.createdBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceDomainClaims.workspaceId,
        set: {
          domain,
          role: input.role,
          verificationToken: token,
          status: "pending",
          verifiedAt: null,
          lastCheckedAt: null,
          createdBy: input.createdBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) return { ok: false, error: "Could not save the domain." };
    return { ok: true, claim: toView(row) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "That domain is already claimed by another workspace." };
    }
    throw error;
  }
}

export async function verifyDomainClaim(input: {
  workspaceId: string;
  lookupTxt?: LookupTxt;
}): Promise<{ ok: true; claim: DomainClaimView } | { ok: false; error: string }> {
  const existing = await getDomainClaim(input.workspaceId);
  if (!existing) return { ok: false, error: "Claim a domain first." };

  const lookup = input.lookupTxt ?? dnsResolveTxt;
  let records: string[][];
  try {
    records = await lookup(existing.txtRecordName);
  } catch {
    return {
      ok: false,
      error: `No TXT record found at ${existing.txtRecordName}. DNS changes can take a few minutes.`,
    };
  }

  const values = records.map((chunks) => chunks.join(""));
  if (!values.includes(existing.verificationToken)) {
    return {
      ok: false,
      error: `Add a TXT record at ${existing.txtRecordName} containing ${existing.verificationToken}.`,
    };
  }

  const now = new Date();
  await db
    .update(workspaceDomainClaims)
    .set({
      status: "verified",
      verifiedAt: now,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(workspaceDomainClaims.workspaceId, input.workspaceId));

  const claim = await getDomainClaim(input.workspaceId);
  return claim ? { ok: true, claim } : { ok: false, error: "Claim not found." };
}

export async function removeDomainClaim(workspaceId: string): Promise<boolean> {
  const rows = await db
    .delete(workspaceDomainClaims)
    .where(and(eq(workspaceDomainClaims.workspaceId, workspaceId)))
    .returning({ id: workspaceDomainClaims.id });
  return Boolean(rows[0]);
}
