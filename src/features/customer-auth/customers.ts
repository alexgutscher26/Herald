import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
  type Customer,
} from "@/db/schema";
import { isUniqueViolation } from "@/lib/error-message";
import { normalizeEmail } from "@/lib/email";

/**
 * Resolve a customer from a verified identity.
 *
 * The external id wins over the email: an app that changes a customer's email
 * must not create a second customer, and an email that already belongs to a
 * different external id is a conflict rather than a silent account takeover.
 *
 * Everything is scoped to the workspace supplied by the caller, which is
 * resolved from the public URL — never from the token or request body.
 */

export type CustomerCompanyIdentity = {
  externalId: string | null;
  name: string;
  domain: string | null;
  role: string | null;
  traits: Record<string, string | number | boolean>;
};

export type CustomerIdentity = {
  externalId: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  traits: Record<string, string | number | boolean>;
  /** `null` leaves existing memberships alone; an array replaces them. */
  companies?: CustomerCompanyIdentity[] | null;
  /** A server-signed token or a consumed magic link proves the address. */
  verifyEmail: boolean;
};

export type IdentityResolution =
  | { ok: true; customer: Customer }
  | { ok: false; reason: "conflict" | "banned" };

function cleanTraits(
  traits: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(traits).slice(0, 30)) {
    const name = key.trim().slice(0, 64);
    if (name.length > 0) cleaned[name] = value;
  }
  return cleaned;
}

function normalizeCompanyDomain(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (host.length === 0) return null;

  try {
    host = host.includes("://")
      ? new URL(host).hostname
      : (host.split("/")[0] ?? "");
  } catch {
    return null;
  }

  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Replace a customer's company memberships from a verified identity token.
 *
 * A token that omits `companies` leaves existing memberships alone; an empty
 * array clears them. Matching prefers the external id, then the normalized
 * domain when no external id is claimed, then a case-insensitive name, so a
 * repeated identify updates rows instead of duplicating them every sign-in.
 */
async function syncCustomerCompanies(
  tx: Transaction,
  workspaceId: string,
  customerId: string,
  companies: CustomerCompanyIdentity[] | null | undefined,
): Promise<void> {
  if (!companies) return;

  await tx
    .delete(customerCompanyMemberships)
    .where(
      and(
        eq(customerCompanyMemberships.workspaceId, workspaceId),
        eq(customerCompanyMemberships.customerId, customerId),
      ),
    );

  const resolved = new Set<string>();
  const now = new Date();

  for (const claim of companies.slice(0, 20)) {
    const name = claim.name.trim().slice(0, 120);
    if (name.length === 0) continue;

    const externalId = claim.externalId?.trim().slice(0, 200) || null;
    const domain = claim.domain?.trim().slice(0, 253) || null;
    const domainNormalized = domain ? normalizeCompanyDomain(domain) : null;
    const traits = cleanTraits(claim.traits);

    const existing = externalId
      ? await tx
          .select({ id: customerCompanies.id, traits: customerCompanies.traits })
          .from(customerCompanies)
          .where(
            and(
              eq(customerCompanies.workspaceId, workspaceId),
              eq(customerCompanies.externalId, externalId),
            ),
          )
          .limit(1)
      : domainNormalized
        ? await tx
            .select({ id: customerCompanies.id, traits: customerCompanies.traits })
            .from(customerCompanies)
            .where(
              and(
                eq(customerCompanies.workspaceId, workspaceId),
                isNull(customerCompanies.externalId),
                eq(customerCompanies.domainNormalized, domainNormalized),
              ),
            )
            .limit(1)
        : await tx
            .select({ id: customerCompanies.id, traits: customerCompanies.traits })
            .from(customerCompanies)
            .where(
              and(
                eq(customerCompanies.workspaceId, workspaceId),
                isNull(customerCompanies.externalId),
                isNull(customerCompanies.domainNormalized),
                sql`lower(${customerCompanies.name}) = ${name.toLowerCase()}`,
              ),
            )
            .limit(1);

    const row = existing[0];
    let companyId: string;

    if (row) {
      companyId = row.id;
      await tx
        .update(customerCompanies)
        .set({
          name,
          domain,
          domainNormalized,
          traits:
            Object.keys(traits).length > 0
              ? { ...row.traits, ...traits }
              : row.traits,
          updatedAt: now,
        })
        .where(
          and(
            eq(customerCompanies.id, companyId),
            eq(customerCompanies.workspaceId, workspaceId),
          ),
        );
    } else {
      const inserted = await tx
        .insert(customerCompanies)
        .values({
          workspaceId,
          externalId,
          name,
          domain,
          domainNormalized,
          traits,
          updatedAt: now,
        })
        .returning({ id: customerCompanies.id });

      const created = inserted[0];
      if (!created) throw new Error("Customer company insert returned no row.");
      companyId = created.id;
    }

    if (resolved.has(companyId)) continue;
    resolved.add(companyId);

    await tx.insert(customerCompanyMemberships).values({
      workspaceId,
      customerId,
      companyId,
      role: claim.role?.trim().slice(0, 80) || null,
    });
  }
}

export async function resolveCustomerIdentity(
  workspaceId: string,
  identity: CustomerIdentity,
): Promise<IdentityResolution> {
  const externalId = identity.externalId?.trim().slice(0, 200) || null;
  const email = identity.email?.trim() || null;
  const emailNormalized = email ? normalizeEmail(email) : null;
  const name = identity.name?.trim().slice(0, 120) || null;
  const avatarUrl = identity.avatarUrl?.trim().slice(0, 500) || null;
  const traits = cleanTraits(identity.traits);
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const byExternal = externalId
        ? await tx
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.workspaceId, workspaceId),
                eq(customers.externalId, externalId),
              ),
            )
            .limit(1)
        : [];
      const byEmail = emailNormalized
        ? await tx
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.workspaceId, workspaceId),
                eq(customers.emailNormalized, emailNormalized),
              ),
            )
            .limit(1)
        : [];

      const externalMatch = byExternal[0] ?? null;
      const emailMatch = byEmail[0] ?? null;

      if (
        externalMatch &&
        emailMatch &&
        externalMatch.id !== emailMatch.id
      ) {
        return { ok: false as const, reason: "conflict" as const };
      }

      const existing = externalMatch ?? emailMatch;
      if (existing?.bannedAt) {
        return { ok: false as const, reason: "banned" as const };
      }

      if (!existing) {
        const inserted = await tx
          .insert(customers)
          .values({
            workspaceId,
            externalId,
            email,
            emailNormalized,
            name,
            avatarUrl,
            traits,
            verifiedAt: identity.verifyEmail && email ? now : null,
            lastSeenAt: now,
          })
          .returning();

        const customer = inserted[0];
        if (!customer) throw new Error("Customer insert returned no row.");
        await syncCustomerCompanies(tx, workspaceId, customer.id, identity.companies);
        return { ok: true as const, customer };
      }

      const update: Partial<typeof customers.$inferInsert> = {
        lastSeenAt: now,
        updatedAt: now,
      };

      if (externalId && existing.externalId === null) {
        update.externalId = externalId;
      }
      if (email && existing.emailNormalized !== emailNormalized) {
        update.email = email;
        update.emailNormalized = emailNormalized;
      }
      if (name) update.name = name;
      if (avatarUrl) update.avatarUrl = avatarUrl;
      if (Object.keys(traits).length > 0) {
        update.traits = { ...existing.traits, ...traits };
      }
      if (identity.verifyEmail && email && existing.verifiedAt === null) {
        update.verifiedAt = now;
      }

      const updated = await tx
        .update(customers)
        .set(update)
        .where(
          and(
            eq(customers.id, existing.id),
            eq(customers.workspaceId, workspaceId),
          ),
        )
        .returning();

      const customer = updated[0];
      if (!customer) throw new Error("Customer update returned no row.");
      await syncCustomerCompanies(tx, workspaceId, customer.id, identity.companies);
      return { ok: true as const, customer };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "conflict" };
    }
    throw error;
  }
}
