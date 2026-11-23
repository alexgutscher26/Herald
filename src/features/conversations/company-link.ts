import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema/customers";
import { conversationMessages, conversations } from "@/db/schema/conversations";

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
]);

function companyDomain(emailNormalized: string | null): string | null {
  if (!emailNormalized) return null;
  const domain = emailNormalized.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  return FREE_MAIL_DOMAINS.has(domain) ? null : domain;
}

function companyNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 120);
}

/**
 * One-click company link.
 *
 * An existing membership always wins. Otherwise the customer's explicit
 * `company` trait, or a non-free email domain, identifies the record. Creating
 * a company from `gmail.com` would be worse than doing nothing, so free-mail
 * addresses return a clear error instead of inventing a company.
 */
export async function linkConversationToCompany(input: {
  productId: string;
  conversationId: string;
  userId: string;
  now?: Date;
}): Promise<ServiceResult<{ companyId: string; companyName: string }>> {
  const rows = await db
    .select({
      workspaceId: conversations.workspaceId,
      customerId: conversations.customerId,
      emailNormalized: customers.emailNormalized,
      traits: customers.traits,
      subject: conversations.subject,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "That conversation no longer exists." };

  const existing = await db
    .select({ id: customerCompanies.id, name: customerCompanies.name })
    .from(customerCompanyMemberships)
    .innerJoin(
      customerCompanies,
      and(
        eq(customerCompanyMemberships.companyId, customerCompanies.id),
        eq(customerCompanyMemberships.workspaceId, customerCompanies.workspaceId),
      ),
    )
    .where(
      and(
        eq(customerCompanyMemberships.customerId, row.customerId),
        eq(customerCompanyMemberships.workspaceId, row.workspaceId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return {
      ok: true,
      data: { companyId: existing[0].id, companyName: existing[0].name },
    };
  }

  const domain = companyDomain(row.emailNormalized);
  const traitCompany =
    typeof row.traits.company === "string" ? row.traits.company.trim() : "";
  if (!domain && traitCompany === "") {
    return {
      ok: false,
      error:
        "This customer has no company and uses a free-mail address. Add a company to their customer record first.",
    };
  }

  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    let company =
      domain === null
        ? undefined
        : (
            await tx
              .select({ id: customerCompanies.id, name: customerCompanies.name })
              .from(customerCompanies)
              .where(
                and(
                  eq(customerCompanies.workspaceId, row.workspaceId),
                  isNull(customerCompanies.externalId),
                  eq(customerCompanies.domainNormalized, domain),
                ),
              )
              .limit(1)
          )[0];

    if (!company) {
      const name = (traitCompany || companyNameFromDomain(domain ?? "Company")).slice(
        0,
        120,
      );
      const inserted = await tx
        .insert(customerCompanies)
        .values({
          workspaceId: row.workspaceId,
          name,
          domain,
          domainNormalized: domain,
          updatedAt: now,
        })
        .returning({ id: customerCompanies.id, name: customerCompanies.name });
      company = inserted[0];
    }
    if (!company) return { ok: false as const, error: "Could not create the company." };

    await tx
      .insert(customerCompanyMemberships)
      .values({
        workspaceId: row.workspaceId,
        customerId: row.customerId,
        companyId: company.id,
        role: null,
      })
      .onConflictDoNothing();

    await tx.insert(conversationMessages).values({
      conversationId: input.conversationId,
      productId: input.productId,
      authorType: "system",
      kind: "note",
      channel: "team",
      body: `Linked this conversation to the company “${company.name}”.`,
      createdAt: now,
    });

    return {
      ok: true as const,
      data: { companyId: company.id, companyName: company.name },
    };
  });
}

/** Used by the thread page to show a company without running the write. */
export async function listCustomerCompanies(input: {
  workspaceId: string;
  customerId: string;
}): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: customerCompanies.id, name: customerCompanies.name })
    .from(customerCompanyMemberships)
    .innerJoin(
      customerCompanies,
      and(
        eq(customerCompanyMemberships.companyId, customerCompanies.id),
        eq(customerCompanyMemberships.workspaceId, customerCompanies.workspaceId),
      ),
    )
    .where(
      and(
        eq(customerCompanyMemberships.customerId, input.customerId),
        eq(customerCompanyMemberships.workspaceId, input.workspaceId),
      ),
    )
    .orderBy(sql`lower(${customerCompanies.name})`)
    .limit(20);
}
