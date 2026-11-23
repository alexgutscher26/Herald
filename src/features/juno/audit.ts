import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { junoRedactionEvents } from "@/db/schema/knowledge";
import { products } from "@/db/schema/workspaces";
import { logEvent, serializeError } from "@/lib/logger";

import type { RedactionCounts, RedactionKind } from "./guardrails";

/**
 * Redaction reporting: counts only.
 *
 * A row is written once per customer message, keyed by the message id, before
 * the redacted question is sent to the model or stored on an answer. The row
 * never contains text or matched values, so the report cannot leak the data it
 * is counting.
 */

export type WorkspaceRedactionReport = {
  windowDays: number;
  messages: number;
  counts: Record<RedactionKind, number>;
  total: number;
  lastEventAt: string | null;
};

export async function recordRedactionEvent(input: {
  productId: string;
  messageId: string;
  counts: RedactionCounts;
  now: Date;
}): Promise<void> {
  if (input.counts.total <= 0) return;

  try {
    await db
      .insert(junoRedactionEvents)
      .values({
        productId: input.productId,
        messageId: input.messageId,
        emailCount: input.counts.email,
        phoneCount: input.counts.phone,
        cardCount: input.counts.card,
        ibanCount: input.counts.iban,
        ssnCount: input.counts.ssn,
        secretCount: input.counts.secret,
        createdAt: input.now,
      })
      .onConflictDoNothing();
  } catch (error) {
    // The audit must never turn a support answer into a failure. A missed count
    // is visible as an under-reported report, not as a lost customer message.
    logEvent("warn", "juno.redaction_audit_failed", { error: serializeError(error) });
  }
}

export async function getWorkspaceRedactionReport(
  workspaceId: string,
  input: { now?: Date; days?: number } = {},
): Promise<WorkspaceRedactionReport> {
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 365);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      messages: sql<number>`count(*)::int`,
      email: sql<number>`coalesce(sum(${junoRedactionEvents.emailCount}), 0)::int`,
      phone: sql<number>`coalesce(sum(${junoRedactionEvents.phoneCount}), 0)::int`,
      card: sql<number>`coalesce(sum(${junoRedactionEvents.cardCount}), 0)::int`,
      iban: sql<number>`coalesce(sum(${junoRedactionEvents.ibanCount}), 0)::int`,
      ssn: sql<number>`coalesce(sum(${junoRedactionEvents.ssnCount}), 0)::int`,
      secret: sql<number>`coalesce(sum(${junoRedactionEvents.secretCount}), 0)::int`,
      lastEventAt: sql<Date | null>`max(${junoRedactionEvents.createdAt})`,
    })
    .from(junoRedactionEvents)
    .innerJoin(products, eq(junoRedactionEvents.productId, products.id))
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        gte(junoRedactionEvents.createdAt, since),
      ),
    );

  const row = rows[0];
  const counts = {
    secret: Number(row?.secret ?? 0),
    email: Number(row?.email ?? 0),
    iban: Number(row?.iban ?? 0),
    ssn: Number(row?.ssn ?? 0),
    card: Number(row?.card ?? 0),
    phone: Number(row?.phone ?? 0),
  };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const lastEventAt = row?.lastEventAt ?? null;

  return {
    windowDays: days,
    messages: Number(row?.messages ?? 0),
    counts,
    total,
    lastEventAt:
      lastEventAt instanceof Date
        ? lastEventAt.toISOString()
        : lastEventAt
          ? String(lastEventAt)
          : null,
  };
}
