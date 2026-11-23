import "server-only";

import { and, asc, count, eq, gt, isNotNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  crmConnections,
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import {
  checkWorkspaceLimit,
  workspaceIntegrationsOverLimit,
} from "@/features/entitlements/entitlements";
import { enqueueJob } from "@/features/jobs/queue";
import { normalizeEmail } from "@/lib/email";
import { logEvent, serializeError } from "@/lib/logger";

import {
  CRM_PROVIDER_LABELS,
  CrmProviderError,
  crmConfigSchema,
  fetchCrmCompany,
  isCrmProvider,
  type CrmProvider,
} from "./crm-providers";

export type CrmConnectionView = {
  id: string;
  provider: CrmProvider;
  providerLabel: string;
  name: string;
  active: boolean;
  instanceUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  companyCount: number;
  updatedAt: string;
};

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export async function listCrmConnections(workspaceId: string): Promise<CrmConnectionView[]> {
  const rows = await db
    .select()
    .from(crmConnections)
    .where(eq(crmConnections.workspaceId, workspaceId))
    .orderBy(asc(crmConnections.provider));

  return Promise.all(
    rows.map(async (row) => {
      const linked = await db
        .select({ value: count() })
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.workspaceId, workspaceId),
            eq(customerCompanies.crmProvider, row.provider),
            isNotNull(customerCompanies.crmSyncedAt),
          ),
        );
      return {
        id: row.id,
        provider: row.provider,
        providerLabel: CRM_PROVIDER_LABELS[row.provider],
        name: row.name,
        active: row.active,
        instanceUrl: row.instanceUrl,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastError: row.lastError,
        companyCount: linked[0]?.value ?? 0,
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  );
}

export async function saveCrmConnection(input: {
  workspaceId: string;
  userId: string;
  provider: CrmProvider;
  name: string;
  apiToken?: string | undefined;
  instanceUrl?: string | undefined;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isCrmProvider(input.provider)) {
    return { ok: false, error: "Choose a supported CRM." };
  }
  const instanceUrl =
    input.provider === "salesforce" && input.instanceUrl?.trim()
      ? httpsOrigin(input.instanceUrl.trim())
      : null;
  if (input.provider === "salesforce" && !instanceUrl) {
    return { ok: false, error: "Salesforce needs an https instance origin." };
  }
  const parsedConfig = crmConfigSchema.safeParse({ instanceUrl: instanceUrl ?? undefined });
  if (!parsedConfig.success) {
    return { ok: false, error: "The CRM configuration is invalid." };
  }

  const existingRows = await db
    .select()
    .from(crmConnections)
    .where(
      and(
        eq(crmConnections.workspaceId, input.workspaceId),
        eq(crmConnections.provider, input.provider),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (existing?.active && (await workspaceIntegrationsOverLimit(input.workspaceId))) {
    return {
      ok: false,
      error:
        "This workspace has more active integrations than its plan allows. Disconnect one before editing a connection.",
    };
  }
  const apiToken = input.apiToken?.trim() || existing?.apiToken || "";
  if (apiToken.length < 8) return { ok: false, error: "Enter a valid read-only CRM token." };

  if (!existing || !existing.active) {
    const limit = await checkWorkspaceLimit(input.workspaceId, "integrations");
    if (!limit.allowed) {
      return {
        ok: false,
        error: `The ${limit.plan} plan allows ${limit.limit} active integration${
          limit.limit === 1 ? "" : "s"
        }. Upgrade to connect another.`,
      };
    }
  }

  const name = input.name.trim().slice(0, 100) || CRM_PROVIDER_LABELS[input.provider];
  const now = new Date();
  if (existing) {
    await db
      .update(crmConnections)
      .set({
        name,
        apiToken,
        instanceUrl,
        active: true,
        updatedAt: now,
      })
      .where(eq(crmConnections.id, existing.id));
    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.crm.connected",
      targetType: "crm_connection",
      targetId: existing.id,
      metadata: { provider: input.provider, updated: true },
    });
    return { ok: true, id: existing.id };
  }

  try {
    const inserted = await db
      .insert(crmConnections)
      .values({
        workspaceId: input.workspaceId,
        provider: input.provider,
        name,
        apiToken,
        instanceUrl,
        active: true,
        createdBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: crmConnections.id });
    const id = inserted[0]?.id;
    if (!id) return { ok: false, error: "Could not save the CRM connection." };
    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.crm.connected",
      targetType: "crm_connection",
      targetId: id,
      metadata: { provider: input.provider, updated: false },
    });
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That CRM is already connected to this workspace." };
    }
    throw error;
  }
}

export async function disconnectCrm(input: {
  workspaceId: string;
  userId: string;
  provider: CrmProvider;
}): Promise<boolean> {
  const rows = await db
    .update(crmConnections)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(crmConnections.workspaceId, input.workspaceId),
        eq(crmConnections.provider, input.provider),
      ),
    )
    .returning({ id: crmConnections.id });
  const id = rows[0]?.id;
  if (!id) return false;
  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.crm.disconnected",
    targetType: "crm_connection",
    targetId: id,
    metadata: { provider: input.provider },
  });
  return true;
}

export async function enqueueCrmConnectionSync(input: {
  connectionId: string;
  dedupeKey: string;
}): Promise<void> {
  await enqueueJob({
    type: "sync_crm_connection",
    dedupeKey: input.dedupeKey,
    payload: { connectionId: input.connectionId },
  });
}

/** Called by the daily scheduler job. */
export async function enqueueScheduledCrmSyncs(day = new Date().toISOString().slice(0, 10)) {
  const rows = await db
    .select({ id: crmConnections.id })
    .from(crmConnections)
    .where(eq(crmConnections.active, true));

  let queued = 0;
  for (const row of rows) {
    try {
      await enqueueCrmConnectionSync({
        connectionId: row.id,
        dedupeKey: `crm-sync:${row.id}:${day}`,
      });
      queued += 1;
    } catch (error) {
      logEvent("warn", "integration.crm.schedule_failed", {
        connectionId: row.id,
        error: serializeError(error),
      });
    }
  }
  return { queued, connections: rows.length };
}

export type CrmSyncResult = {
  connectionId: string;
  provider: CrmProvider;
  processed: number;
  failed: number;
  matched: number;
  truncated: boolean;
};

/**
 * Refresh the cached company, contact and deal totals.
 *
 * The job processes at most 200 companies per invocation, always in company-id
 * order and always scoped to the connection's workspace. A provider failure
 * marks only that company; other companies continue. The cached columns are
 * written here and nowhere else.
 */
export async function syncCrmConnection(
  connectionId: string,
  fetchImpl?: typeof fetch,
): Promise<CrmSyncResult> {
  const rows = await db
    .select()
    .from(crmConnections)
    .where(and(eq(crmConnections.id, connectionId), eq(crmConnections.active, true)))
    .limit(1);
  const connection = rows[0];
  if (!connection) {
    return {
      connectionId,
      provider: "hubspot",
      processed: 0,
      failed: 0,
      matched: 0,
      truncated: false,
    };
  }

  let cursor: string | null = null;
  let processed = 0;
  let failed = 0;
  let matched = 0;
  let truncated = false;
  const firstError: string[] = [];

  for (let page = 0; page < 4; page += 1) {
    const companies = await db
      .select({
        id: customerCompanies.id,
        name: customerCompanies.name,
        domain: customerCompanies.domainNormalized,
        externalId: customerCompanies.externalId,
        crmExternalId: customerCompanies.crmExternalId,
      })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.workspaceId, connection.workspaceId),
          or(
            isNotNull(customerCompanies.domainNormalized),
            isNotNull(customerCompanies.crmExternalId),
            isNotNull(customerCompanies.externalId),
          ),
          cursor ? gt(customerCompanies.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(customerCompanies.id))
      .limit(50);

    for (const company of companies) {
      processed += 1;
      cursor = company.id;
      try {
        const snapshot = await fetchCrmCompany({
          provider: connection.provider,
          token: connection.apiToken,
          instanceUrl: connection.instanceUrl,
          domain: company.domain,
          externalId: company.crmExternalId ?? company.externalId,
          fetchImpl,
        });
        if (!snapshot) {
          await db
            .update(customerCompanies)
            .set({
              crmProvider: connection.provider,
              crmSyncedAt: new Date(),
              crmSyncError: "No matching CRM company was found for this domain.",
            })
            .where(
              and(
                eq(customerCompanies.id, company.id),
                eq(customerCompanies.workspaceId, connection.workspaceId),
              ),
            );
          continue;
        }

        await db
          .update(customerCompanies)
          .set({
            crmProvider: connection.provider,
            crmExternalId: snapshot.externalId,
            crmContactCount: snapshot.contactCount,
            crmOpenDealCount: snapshot.openDealCount,
            crmOpenDealValueCents: snapshot.openDealValueCents,
            crmAnnualRevenueCents: snapshot.annualRevenueCents,
            crmSyncedAt: new Date(),
            crmSyncError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(customerCompanies.id, company.id),
              eq(customerCompanies.workspaceId, connection.workspaceId),
            ),
          );

        const members = await db
          .select({
            id: customers.id,
            emailNormalized: customers.emailNormalized,
          })
          .from(customerCompanyMemberships)
          .innerJoin(customers, eq(customerCompanyMemberships.customerId, customers.id))
          .where(
            and(
              eq(customerCompanyMemberships.companyId, company.id),
              eq(customerCompanyMemberships.workspaceId, connection.workspaceId),
              eq(customers.workspaceId, connection.workspaceId),
            ),
          );

        const contactsByEmail = new Map(
          snapshot.contacts
            .map((contact) => [contact.email ? normalizeEmail(contact.email) : "", contact] as const)
            .filter(([email]) => email !== ""),
        );
        const now = new Date();
        for (const member of members) {
          const contact = member.emailNormalized
            ? contactsByEmail.get(member.emailNormalized)
            : undefined;
          await db
            .update(customers)
            .set({
              crmProvider: connection.provider,
              crmCompanyExternalId: snapshot.externalId,
              crmExternalId: contact?.externalId ?? null,
              crmLifecycleStage: contact?.lifecycleStage ?? null,
              crmSyncedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(customers.id, member.id),
                eq(customers.workspaceId, connection.workspaceId),
              ),
            );
          if (contact) matched += 1;
        }
      } catch (error) {
        failed += 1;
        const message =
          error instanceof CrmProviderError
            ? error.message
            : "The CRM sync failed for this company.";
        if (firstError.length === 0) firstError.push(message);
        await db
          .update(customerCompanies)
          .set({
            crmProvider: connection.provider,
            crmSyncedAt: new Date(),
            crmSyncError: message.slice(0, 1_000),
          })
          .where(
            and(
              eq(customerCompanies.id, company.id),
              eq(customerCompanies.workspaceId, connection.workspaceId),
            ),
          );
      }
    }

    if (companies.length < 50) break;
    if (page === 3) truncated = true;
  }

  const now = new Date();
  await db
    .update(crmConnections)
    .set({
      lastSyncedAt: now,
      lastError: failed > 0 ? firstError[0]?.slice(0, 1_000) ?? "Some companies failed." : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(crmConnections.id, connection.id),
        eq(crmConnections.workspaceId, connection.workspaceId),
      ),
    );

  return {
    connectionId,
    provider: connection.provider,
    processed,
    failed,
    matched,
    truncated,
  };
}
