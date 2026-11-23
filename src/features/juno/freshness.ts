import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  knowledgePages,
  knowledgeSources,
  knowledgeVersions,
} from "@/db/schema/knowledge";
import { enqueueJob } from "@/features/jobs/queue";
import { logEvent, serializeError } from "@/lib/logger";

import type { KnowledgePageSnapshot } from "./diff";

export {
  hasKnowledgeChange,
  summarizeKnowledgeChange,
  type KnowledgeChange,
  type KnowledgePageSnapshot,
} from "./diff";

/**
 * Knowledge freshness.
 *
 * A crawled source can be checked on its own interval. The sweep only queues a
 * source that has no build in flight, so a slow crawl cannot stack versions.
 * The resulting build compares its page set with the live version and records
 * what changed; the settings page shows that as a "source changed" alert.
 */

/** Page snapshots for the version currently serving retrieval. */
export async function liveKnowledgePages(
  sourceId: string,
): Promise<KnowledgePageSnapshot[]> {
  const rows = await db
    .select({
      url: knowledgePages.url,
      title: knowledgePages.title,
      content: knowledgePages.content,
    })
    .from(knowledgePages)
    .innerJoin(knowledgeVersions, eq(knowledgePages.versionId, knowledgeVersions.id))
    .where(
      and(
        eq(knowledgePages.sourceId, sourceId),
        eq(knowledgeVersions.status, "live"),
      ),
    );
  return rows;
}

/**
 * Queue due recrawls. Runs from the minute cron; a scheduler invocation that
 * finds nothing due does no writes. A failed queue insert only skips that
 * source for this tick.
 */
export async function scheduleKnowledgeRecrawls(
  now: Date = new Date(),
  limit = 10,
): Promise<{ queued: number; checked: number }> {
  const due = await db
    .select({
      id: knowledgeSources.id,
      productId: knowledgeSources.productId,
    })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.kind, "url"),
        eq(knowledgeSources.status, "live"),
        sql`${knowledgeSources.recrawlIntervalHours} > 0`,
        sql`${knowledgeSources.lastCheckedAt} is null or ${knowledgeSources.lastCheckedAt} < ${now} - (${knowledgeSources.recrawlIntervalHours} * interval '1 hour')`,
      ),
    )
    .limit(Math.min(Math.max(limit, 1), 25));

  if (due.length === 0) return { queued: 0, checked: 0 };

  const building = await db
    .select({ sourceId: knowledgeVersions.sourceId })
    .from(knowledgeVersions)
    .where(
      and(
        inArray(
          knowledgeVersions.sourceId,
          due.map((source) => source.id),
        ),
        eq(knowledgeVersions.status, "building"),
      ),
    );
  const busy = new Set(building.map((row) => row.sourceId));

  let queued = 0;
  for (const source of due) {
    if (busy.has(source.id)) continue;

    const inserted = await db
      .insert(knowledgeVersions)
      .values({
        sourceId: source.id,
        productId: source.productId,
        status: "building",
      })
      .returning({ id: knowledgeVersions.id });
    const versionId = inserted[0]?.id;
    if (!versionId) continue;

    try {
      await enqueueJob({
        type: "crawl_knowledge",
        payload: { sourceId: source.id, versionId },
        dedupeKey: `crawl:freshness:${versionId}`,
      });
      queued += 1;
    } catch (error) {
      await db
        .update(knowledgeVersions)
        .set({ status: "failed", error: "Could not queue the scheduled recrawl." })
        .where(eq(knowledgeVersions.id, versionId));
      logEvent("warn", "juno.recrawl_schedule_failed", {
        error: serializeError(error),
      });
    }
  }

  return { queued, checked: due.length };
}
