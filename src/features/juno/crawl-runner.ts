import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { knowledgeSources } from "@/db/schema/knowledge";

import { crawlPages } from "./crawl";
import {
  hasKnowledgeChange,
  liveKnowledgePages,
  summarizeKnowledgeChange,
} from "./freshness";
import { failKnowledgeVersion, ingestKnowledgeVersion } from "./ingest";

/**
 * The body of the `crawl_knowledge` job.
 *
 * A failure marks the version failed and rethrows so the durable queue applies
 * its retry policy. The previous live version keeps serving throughout, which
 * is why `failKnowledgeVersion` leaves a source with an active version live.
 * A successful recrawl is diffed against the version it replaces, so the team
 * sees which pages were added, removed or changed instead of a silent swap.
 */
export async function runKnowledgeCrawl(input: {
  sourceId: string;
  versionId: string;
}): Promise<{ pageCount: number; chunkCount: number }> {
  const rows = await db
    .select({
      productId: knowledgeSources.productId,
      url: knowledgeSources.url,
      kind: knowledgeSources.kind,
    })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.id, input.sourceId))
    .limit(1);

  const source = rows[0];
  if (!source || source.kind !== "url" || !source.url) {
    throw new Error("That crawled source no longer exists.");
  }

  try {
    const previous = await liveKnowledgePages(input.sourceId);
    const pages = await crawlPages(source.url);
    const change = summarizeKnowledgeChange(previous, pages);
    const result = await ingestKnowledgeVersion({
      sourceId: input.sourceId,
      productId: source.productId,
      versionId: input.versionId,
      pages,
    });

    const now = new Date();
    await db
      .update(knowledgeSources)
      .set({
        lastCheckedAt: now,
        ...(previous.length > 0 && hasKnowledgeChange(change)
          ? { lastChangedAt: now, lastChangeSummary: change }
          : {}),
      })
      .where(eq(knowledgeSources.id, input.sourceId));

    return result;
  } catch (error) {
    await db
      .update(knowledgeSources)
      .set({ lastCheckedAt: new Date() })
      .where(eq(knowledgeSources.id, input.sourceId));
    await failKnowledgeVersion({
      sourceId: input.sourceId,
      productId: source.productId,
      versionId: input.versionId,
      error: error instanceof Error ? error.message : "The crawl failed.",
    });
    throw error;
  }
}
