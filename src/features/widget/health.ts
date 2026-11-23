import "server-only";

import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { analyticsEvents } from "@/db/schema/analytics";
import { inAppNotifications } from "@/db/schema/notifications";

/**
 * Widget installation health.
 *
 * The loader beacons one `widget_install` event per boot with its version and
 * host origin (never a page URL, identity or session). This reads the latest
 * evidence so an operator can tell "nobody has installed it" from "the snippet
 * points at the wrong key". Unread is product-wide: it is the number of in-app
 * notification rows the widget's inbox is showing as unread across customers.
 */

export type WidgetHealth = {
  lastInstallAt: string | null;
  lastOrigin: string | null;
  lastVersion: string | null;
  installsLast7Days: number;
  origins: string[];
  unread: number;
};

export async function readWidgetHealth(input: {
  workspaceId: string;
  productId: string;
}): Promise<WidgetHealth> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const install = and(
    eq(analyticsEvents.workspaceId, input.workspaceId),
    eq(analyticsEvents.productId, input.productId),
    eq(analyticsEvents.type, "widget_install"),
  );

  const [latestRows, installRows, originRows, unreadRows] = await Promise.all([
    db
      .select({
        occurredAt: analyticsEvents.occurredAt,
        metadata: analyticsEvents.metadata,
      })
      .from(analyticsEvents)
      .where(install)
      .orderBy(desc(analyticsEvents.occurredAt))
      .limit(1),
    db
      .select({ value: count() })
      .from(analyticsEvents)
      .where(and(install, gte(analyticsEvents.occurredAt, since))),
    db
      .selectDistinct({
        origin: sql<string | null>`${analyticsEvents.metadata}->>'origin'`,
      })
      .from(analyticsEvents)
      .where(install)
      .limit(20),
    db
      .select({ value: count() })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.workspaceId, input.workspaceId),
          eq(inAppNotifications.productId, input.productId),
          isNull(inAppNotifications.readAt),
        ),
      ),
  ]);

  const latest = latestRows[0] ?? null;
  const metadata = latest?.metadata ?? null;

  return {
    lastInstallAt: latest?.occurredAt.toISOString() ?? null,
    lastOrigin:
      typeof metadata?.origin === "string" ? metadata.origin : null,
    lastVersion:
      typeof metadata?.version === "string" ? metadata.version : null,
    installsLast7Days: installRows[0]?.value ?? 0,
    origins: originRows
      .map((row) => row.origin)
      .filter((origin): origin is string => typeof origin === "string"),
    unread: unreadRows[0]?.value ?? 0,
  };
}
