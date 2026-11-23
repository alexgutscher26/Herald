import "server-only";

import { resolveTxt as dnsResolveTxt } from "node:dns/promises";
import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceDomains } from "@/db/schema/domains";
import { products } from "@/db/schema/workspaces";
import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { limitFailure } from "@/features/billing/links";

/**
 * Custom-domain verification and health.
 *
 * A domain is not "connected" because it was typed into a form. It becomes
 * verified only when the TXT challenge is present, and healthy only after the
 * public readiness endpoint answers successfully over HTTPS. Both checks are
 * explicit and their results are stored with timestamps.
 */

const TXT_PREFIX = "_herald.";
const HEALTH_TIMEOUT_MS = 5_000;

export type DomainView = {
  id: string;
  domain: string;
  productSlug: string;
  productName: string;
  verificationToken: string;
  txtRecordName: string;
  status: "pending" | "verified";
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  healthStatus: "unknown" | "healthy" | "unhealthy";
  healthMessage: string | null;
};

type LookupTxt = (hostname: string) => Promise<string[][]>;
type FetchImpl = typeof fetch;

export function normalizeCustomDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > 253) return null;
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.split("/")[0]?.split(":")[0]?.replace(/\.$/, "") ?? "";
  if (!value.includes(".") || value === "localhost") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)) {
    return null;
  }
  return value;
}

function toView(row: typeof workspaceDomains.$inferSelect, product: {
  slug: string;
  name: string;
}): DomainView {
  return {
    id: row.id,
    domain: row.domain,
    productSlug: product.slug,
    productName: product.name,
    verificationToken: row.verificationToken,
    txtRecordName: `${TXT_PREFIX}${row.domain}`,
    status: row.status === "verified" ? "verified" : "pending",
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    healthStatus:
      row.healthStatus === "healthy" || row.healthStatus === "unhealthy"
        ? row.healthStatus
        : "unknown",
    healthMessage: row.healthMessage,
  };
}

export async function getWorkspaceDomain(
  workspaceId: string,
): Promise<DomainView | null> {
  const rows = await db
    .select({ domain: workspaceDomains, product: products })
    .from(workspaceDomains)
    .innerJoin(products, eq(workspaceDomains.productId, products.id))
    .where(eq(workspaceDomains.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row ? toView(row.domain, row.product) : null;
}

export async function saveWorkspaceDomain(input: {
  workspaceId: string;
  workspaceSlug: string;
  productId: string;
  domain: string;
}): Promise<
  { ok: true; domain: DomainView } | { ok: false; error: string; billingUrl?: string }
> {
  const feature = await checkWorkspaceFeature(input.workspaceId, "customDomains");
  if (!feature.allowed) {
    return limitFailure(
      "Custom domains are available on Indie and Professional.",
      input.workspaceSlug,
    );
  }

  const domain = normalizeCustomDomain(input.domain);
  if (!domain) {
    return { ok: false, error: "Enter a hostname such as feedback.example.com." };
  }

  const productRows = await db
    .select({ id: products.id, slug: products.slug, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const product = productRows[0];
  if (!product) return { ok: false, error: "Choose a product in this workspace." };

  const token = `herald-verify-${randomBytes(18).toString("hex")}`;
  try {
    const rows = await db
      .insert(workspaceDomains)
      .values({
        workspaceId: input.workspaceId,
        productId: product.id,
        domain,
        verificationToken: token,
        status: "pending",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceDomains.workspaceId,
        set: {
          productId: product.id,
          domain,
          verificationToken: token,
          status: "pending",
          verifiedAt: null,
          lastCheckedAt: null,
          healthStatus: "unknown",
          healthMessage: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) return { ok: false, error: "Could not save the domain." };
    return { ok: true, domain: toView(row, product) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That domain is already connected to another workspace." };
    }
    throw error;
  }
}

export async function verifyWorkspaceDomain(input: {
  workspaceId: string;
  lookupTxt?: LookupTxt;
}): Promise<{ ok: true; domain: DomainView } | { ok: false; error: string }> {
  const existing = await getWorkspaceDomain(input.workspaceId);
  if (!existing) return { ok: false, error: "Add a domain first." };

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
    .update(workspaceDomains)
    .set({
      status: "verified",
      verifiedAt: now,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(workspaceDomains.workspaceId, input.workspaceId));

  const domain = await getWorkspaceDomain(input.workspaceId);
  return domain ? { ok: true, domain } : { ok: false, error: "Domain not found." };
}

export async function checkWorkspaceDomainHealth(input: {
  workspaceId: string;
  fetchImpl?: FetchImpl;
}): Promise<{ ok: true; domain: DomainView } | { ok: false; error: string }> {
  const existing = await getWorkspaceDomain(input.workspaceId);
  if (!existing) return { ok: false, error: "Add a domain first." };
  if (existing.status !== "verified") {
    return { ok: false, error: "Verify the DNS record before checking health." };
  }

  const fetcher = input.fetchImpl ?? fetch;
  const now = new Date();
  let healthStatus: "healthy" | "unhealthy" = "unhealthy";
  let message = "The readiness endpoint did not return a healthy response.";

  try {
    const response = await fetcher(
      `https://${existing.domain}/api/health?scope=readiness`,
      {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { status?: unknown; scope?: unknown }
      | null;
    if (response.ok && payload?.status === "ok") {
      healthStatus = "healthy";
      message = "HTTPS and the readiness check both answered.";
    } else {
      message = `The readiness endpoint answered HTTP ${response.status}.`;
    }
  } catch (error) {
    message =
      error instanceof Error && error.name === "TimeoutError"
        ? "The readiness check timed out."
        : "Could not reach the domain over HTTPS.";
  }

  await db
    .update(workspaceDomains)
    .set({
      healthStatus,
      healthMessage: message,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(workspaceDomains.workspaceId, input.workspaceId));

  const domain = await getWorkspaceDomain(input.workspaceId);
  return domain ? { ok: true, domain } : { ok: false, error: "Domain not found." };
}

export async function removeWorkspaceDomain(workspaceId: string): Promise<boolean> {
  const rows = await db
    .delete(workspaceDomains)
    .where(eq(workspaceDomains.workspaceId, workspaceId))
    .returning({ id: workspaceDomains.id });
  return Boolean(rows[0]);
}
