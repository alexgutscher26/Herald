import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceDomainClaims } from "@/db/schema/domain-claims";
import { workspaceMembers, workspaces } from "@/db/schema/workspaces";
import { checkWorkspaceLimit } from "@/features/entitlements/entitlements";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Email-domain capture.
 *
 * A workspace owner can claim `acme.com`; every new account whose address ends
 * in `@acme.com` then joins that workspace automatically on sign-up. Three
 * rules keep that from becoming a hole:
 *
 *   1. Only a **verified** claim joins anyone. The claim carries a DNS TXT
 *      challenge, so the claimant must control the domain's DNS.
 *   2. A public mailbox provider can never be claimed, because sharing a
 *      provider is not sharing a company.
 *   3. A capture never grants ownership, and a paid seat is only used when the
 *      plan still has room. When it does not, the sign-up goes through and the
 *      skip is logged — an entitlement limit must not break account creation.
 */

/** Providers where an address says nothing about the employer. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "gmx.com",
  "gmx.de",
  "hotmail.com",
  "hotmail.co.uk",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "tutanota.com",
  "yandex.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yeah.net",
  "zoho.com",
  "163.com",
  "126.com",
]);

export type CapturedDomainRole = "editor" | "viewer";

/** The domain part of an email address, lowercased, or null when there is none. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain.includes(".") || domain.length > 253) return null;
  return domain;
}

/**
 * Normalize owner input (`@acme.com`, `acme.com`, a pasted URL) to a bare
 * domain, or null when it cannot be a company domain.
 */
export function normalizeEmailDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > 253) return null;
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/^@/, "").split("/")[0]?.split(":")[0]?.replace(/\.$/, "") ?? "";
  if (!value.includes(".") || value === "localhost") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)) {
    return null;
  }
  if (PUBLIC_MAIL_DOMAINS.has(value)) return null;
  return value;
}

/**
 * Join every workspace that has verified a claim for this account's domain.
 *
 * Called after a user row is created. It must never throw: sign-up has already
 * succeeded by then, and a capture problem is not a reason to fail it.
 */
export async function joinVerifiedDomainWorkspaces(input: {
  userId: string;
  email: string;
}): Promise<string[]> {
  const domain = emailDomain(input.email);
  if (!domain) return [];

  try {
    const claims = await db
      .select({
        workspaceId: workspaceDomainClaims.workspaceId,
        role: workspaceDomainClaims.role,
        slug: workspaces.slug,
      })
      .from(workspaceDomainClaims)
      .innerJoin(workspaces, eq(workspaceDomainClaims.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceDomainClaims.domain, domain),
          eq(workspaceDomainClaims.status, "verified"),
        ),
      );

    const joined: string[] = [];
    for (const claim of claims) {
      const existing = await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, claim.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        )
        .limit(1);
      if (existing[0]) continue;

      const role = claim.role === "viewer" ? "viewer" : "editor";
      if (role !== "viewer") {
        const limit = await checkWorkspaceLimit(claim.workspaceId, "members");
        if (!limit.allowed) {
          logEvent("warn", "workspace.domain_capture_seat_limit", {
            workspaceId: claim.workspaceId,
            domain,
          });
          continue;
        }
      }

      await db
        .insert(workspaceMembers)
        .values({ workspaceId: claim.workspaceId, userId: input.userId, role })
        .onConflictDoNothing();
      joined.push(claim.slug);
    }
    return joined;
  } catch (error) {
    logEvent("error", "workspace.domain_capture_failed", {
      domain,
      error: serializeError(error),
    });
    return [];
  }
}
