import type { MetadataRoute } from "next";

import {
  publicApiDocPath,
  publicApiDocsPath,
  publicBoardPath,
  publicChangelogEntryPath,
  publicChangelogPath,
  publicHelpArticlePath,
  publicHelpCollectionPath,
  publicHelpPath,
  publicRequestPath,
  publicRoadmapPath,
} from "@/features/public/paths";
import { listPublicSitemapEntries } from "@/features/public/queries";
import { listPublicRoadmapSitemapEntries } from "@/features/public/roadmap";
import { absolutePublicUrl } from "@/features/public/urls";

/**
 * Public sitemap.
 *
 * Entries come from the public projections, not from every row in the
 * database. Archived or private boards, hidden, merged, archived and
 * unapproved requests are omitted, and a workspace whose plan or deployment
 * flag closes the public surface contributes nothing. The query is dynamic
 * because a moderation decision or archive must be reflected immediately.
 */

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [entries, roadmapViews] = await Promise.all([
    listPublicSitemapEntries(),
    listPublicRoadmapSitemapEntries(),
  ]);

  const statusEntry = {
    url: absolutePublicUrl("/status"),
    changeFrequency: "daily" as const,
    priority: 0.3,
  };

  const trustEntries = [
    { path: "/trust", priority: 0.4 },
    { path: "/legal/privacy", priority: 0.4 },
    { path: "/legal/terms", priority: 0.4 },
    { path: "/legal/dpa", priority: 0.4 },
    { path: "/legal/subprocessors", priority: 0.4 },
    { path: "/legal/data-residency", priority: 0.4 },
    { path: "/legal/lifetime", priority: 0.4 },
    { path: "/accessibility", priority: 0.4 },
  ].map((entry) => ({
    url: absolutePublicUrl(entry.path),
    changeFrequency: "monthly" as const,
    priority: entry.priority,
  }));

  const marketingEntries = [
    { path: "/pricing", priority: 0.9 },
    { path: "/docs", priority: 0.7 },
    { path: "/docs/integrations/segment", priority: 0.5 },
    { path: "/docs/integrations/zapier", priority: 0.5 },
    { path: "/docs/api", priority: 0.5 },
    { path: "/docs/api/workflows", priority: 0.5 },
    { path: "/docs/api/cookbook", priority: 0.5 },
    { path: "/docs/api/versioning", priority: 0.5 },
    { path: "/docs/api/events", priority: 0.5 },
    { path: "/docs/integrations/slack", priority: 0.5 },
    { path: "/docs/mcp", priority: 0.5 },
    { path: "/demo", priority: 0.8 },
    { path: "/open-source", priority: 0.6 },
    { path: "/compare", priority: 0.7 },
    { path: "/compare/canny", priority: 0.7 },
    { path: "/compare/featurebase", priority: 0.7 },
    { path: "/compare/userjot", priority: 0.7 },
  ].map((entry) => ({
    url: absolutePublicUrl(entry.path),
    changeFrequency: "monthly" as const,
    priority: entry.priority,
  }));

  return [
    {
      url: absolutePublicUrl("/"),
      changeFrequency: "weekly" as const,
      priority: 1,
    },
    statusEntry,
    ...trustEntries,
    ...marketingEntries,
    ...roadmapViews.map((entry) => ({
      url: absolutePublicUrl(
        publicRoadmapPath(entry.workspaceSlug, entry.productSlug, entry.roadmapSlug),
      ),
      lastModified: entry.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...entries.map((entry) => {
    if (entry.kind === "roadmap") {
      return {
        url: absolutePublicUrl(publicRoadmapPath(entry.workspaceSlug, entry.productSlug)),
        lastModified: entry.lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      };
    }

    if (entry.kind === "changelog") {
      return {
        url: absolutePublicUrl(publicChangelogPath(entry.workspaceSlug, entry.productSlug)),
        lastModified: entry.lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      };
    }

    if (entry.kind === "changelog_entry") {
      return {
        url: absolutePublicUrl(
          publicChangelogEntryPath(entry.workspaceSlug, entry.productSlug, entry.slug),
        ),
        lastModified: entry.lastModified,
        changeFrequency: "monthly" as const,
        priority: 0.7,
      };
    }

    if (entry.kind === "help") {
      return {
        url: absolutePublicUrl(publicHelpPath(entry.workspaceSlug, entry.productSlug)),
        lastModified: entry.lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      };
    }

    if (entry.kind === "help_collection") {
      return {
        url: absolutePublicUrl(
          publicHelpCollectionPath(
            entry.workspaceSlug,
            entry.productSlug,
            entry.collectionSlug,
          ),
        ),
        lastModified: entry.lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      };
    }

    if (entry.kind === "help_article") {
      return {
        url: absolutePublicUrl(
          publicHelpArticlePath(
            entry.workspaceSlug,
            entry.productSlug,
            entry.collectionSlug,
            entry.articleSlug,
          ),
        ),
        lastModified: entry.lastModified,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      };
    }

    if (entry.kind === "api_docs") {
      return {
        url: absolutePublicUrl(publicApiDocsPath(entry.workspaceSlug, entry.productSlug)),
        lastModified: entry.lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      };
    }

    if (entry.kind === "api_doc") {
      return {
        url: absolutePublicUrl(
          publicApiDocPath(entry.workspaceSlug, entry.productSlug, entry.docSlug),
        ),
        lastModified: entry.lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      };
    }

    if (entry.kind === "request") {
      return {
        url: absolutePublicUrl(
          publicRequestPath(
            entry.workspaceSlug,
            entry.productSlug,
            entry.boardSlug,
            entry.requestId,
          ),
        ),
        lastModified: entry.lastModified,
        changeFrequency: "daily" as const,
        priority: 0.6,
      };
    }

    return {
      url: absolutePublicUrl(
        publicBoardPath(entry.workspaceSlug, entry.productSlug, entry.boardSlug),
      ),
      lastModified: entry.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    };
  })];
}
