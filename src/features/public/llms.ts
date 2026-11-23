import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { listPublicApiDocs } from "@/features/api-docs/service";
import { getPublicHelpIndex } from "@/features/help/service";
import {
  boards,
  customers,
  feedbackPosts,
  products,
  releases,
  workspaces,
} from "@/db/schema";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { toPlanId } from "@/features/entitlements/plans";

import { loadAccessiblePublicBoards } from "./access";
import {
  publicApiDocPath,
  publicApiDocsPath,
  publicBoardPath,
  publicChangelogEntryPath,
  publicChangelogPath,
  publicHelpArticlePath,
  publicHelpCollectionPath,
  publicHelpPath,
  publicLlmsPath,
  publicProductPath,
  publicRequestPath,
  publicRoadmapPath,
} from "./paths";
import { listPublishedRoadmaps } from "./roadmap";
import { excerpt } from "./similarity";
function absolute(path: string, origin: string): string {
  return new URL(path, origin).toString();
}

/**
 * A deliberately small, text-only projection for LLM crawlers.
 *
 * It starts from the same public predicates as the HTML pages. Private boards,
 * segment-gated boards, hidden/merged/archived requests, pending moderation,
 * banned authors and non-public privacy rows never enter this document.
 */

export type LlmsProduct = {
  workspaceSlug: string;
  productSlug: string;
  name: string;
  description: string | null;
};

function latestPostModerationSql() {
  return sql<string | null>`(
    SELECT mr.status::text FROM moderation_reviews mr
    WHERE mr.content_type = 'feedback_post'
      AND mr.content_id = ${feedbackPosts.id}
    ORDER BY mr.created_at DESC LIMIT 1
  )`;
}

export async function listPublicLlmsProducts(): Promise<LlmsProduct[]> {
  const rows = await db
    .select({
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      name: products.name,
      description: products.description,
      plan: workspaces.plan,
      feedback: products.publicFeedbackEnabled,
      roadmap: products.publicRoadmapEnabled,
      changelog: products.publicChangelogEnabled,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      sql`${products.publicFeedbackEnabled} OR ${products.publicRoadmapEnabled} OR ${products.publicChangelogEnabled}`,
    )
    .orderBy(asc(workspaces.slug), asc(products.slug))
    .limit(500);

  return rows
    .filter(
      (row) =>
        publicSurfaceEnabled(toPlanId(row.plan)) &&
        (row.feedback || row.roadmap || row.changelog),
    )
    .map((row) => ({
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      name: row.name,
      description: row.description,
    }));
}

export function buildGlobalLlmsDocument(input: {
  origin: string;
  products: LlmsProduct[];
}): string {
  const lines = [
    "# Herald public feedback",
    "",
    "> Public product feedback, roadmaps and changelogs. Private and unlisted content is not included.",
    "",
    "## Products",
    "",
  ];

  if (input.products.length === 0) {
    lines.push("No product has a public surface yet.");
  } else {
    for (const product of input.products) {
      const productUrl = absolute(
        publicProductPath(product.workspaceSlug, product.productSlug),
        input.origin,
      );
      lines.push(
        `- [${product.name}](${productUrl})${product.description ? ` — ${product.description}` : ""}`,
      );
      lines.push(
        `  - AI-readable: ${absolute(
          publicLlmsPath(product.workspaceSlug, product.productSlug),
          input.origin,
        )}`,
      );
    }
  }

  lines.push("", "## Sitemap", "", `- ${absolute("/sitemap.xml", input.origin)}`, "");
  return lines.join("\n");
}

export async function getProductLlmsDocument(input: {
  workspaceSlug: string;
  productSlug: string;
  origin: string;
}): Promise<string | null> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      workspaceName: workspaces.name,
      plan: workspaces.plan,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      description: products.description,
      publicFeedbackEnabled: products.publicFeedbackEnabled,
      publicRoadmapEnabled: products.publicRoadmapEnabled,
      publicChangelogEnabled: products.publicChangelogEnabled,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        sql`${products.publicFeedbackEnabled} OR ${products.publicRoadmapEnabled} OR ${products.publicChangelogEnabled}`,
      ),
    )
    .limit(1);

  const tenant = rows[0];
  if (!tenant || !publicSurfaceEnabled(toPlanId(tenant.plan))) return null;

  const boardsForProduct = await loadAccessiblePublicBoards({
    productId: tenant.productId,
    workspaceId: tenant.workspaceId,
  });

  const [requestRows, releaseRows, roadmapRows, helpPage, apiDocsPage] = await Promise.all([
    tenant.publicFeedbackEnabled && boardsForProduct.length > 0
      ? db
          .select({
            id: feedbackPosts.id,
            title: feedbackPosts.title,
            body: feedbackPosts.body,
            status: feedbackPosts.status,
            boardSlug: boards.slug,
            boardName: boards.name,
            updatedAt: feedbackPosts.updatedAt,
          })
          .from(feedbackPosts)
          .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
          .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
          .where(
            and(
              inArray(
                feedbackPosts.boardId,
                boardsForProduct.map((board) => board.id),
              ),
              eq(feedbackPosts.productId, tenant.productId),
              eq(boards.visibility, "public"),
              isNull(boards.archivedAt),
              isNull(feedbackPosts.archivedAt),
              isNull(feedbackPosts.hiddenAt),
              isNull(feedbackPosts.mergedIntoId),
              isNull(customers.bannedAt),
              eq(feedbackPosts.privacy, "public"),
              sql`case when coalesce(${boards.settings} #>> '{moderation,requireApproval}', 'none') = 'none' then ${latestPostModerationSql()} is distinct from 'rejected' else ${latestPostModerationSql()} = 'approved' end`,
            ),
          )
          .orderBy(desc(feedbackPosts.updatedAt))
          .limit(500)
      : Promise.resolve([]),
    tenant.publicChangelogEnabled
      ? db
          .select({
            title: releases.title,
            slug: releases.slug,
            summary: releases.summary,
            publishedAt: releases.publishedAt,
          })
          .from(releases)
          .where(
            and(
              eq(releases.productId, tenant.productId),
              eq(releases.status, "published"),
              eq(releases.channelPublicChangelog, true),
              isNotNull(releases.publishedAt),
            ),
          )
          .orderBy(desc(releases.publishedAt))
          .limit(100)
      : Promise.resolve([]),
    tenant.publicRoadmapEnabled
      ? listPublishedRoadmaps(tenant.productId)
      : Promise.resolve([]),
    getPublicHelpIndex({ workspaceSlug: tenant.workspaceSlug, productSlug: tenant.productSlug }),
    listPublicApiDocs({ workspaceSlug: tenant.workspaceSlug, productSlug: tenant.productSlug }),
  ]);

  const lines = [
    `# ${tenant.productName}`,
    "",
    tenant.description ? `> ${tenant.description}` : `> Public feedback from ${tenant.workspaceName}.`,
    "",
    `Site: ${absolute(
      publicProductPath(tenant.workspaceSlug, tenant.productSlug),
      input.origin,
    )}`,
    "",
  ];

  if (boardsForProduct.length > 0) {
    lines.push("## Boards", "");
    for (const board of boardsForProduct) {
      lines.push(
        `- [${board.name}](${absolute(
          publicBoardPath(tenant.workspaceSlug, tenant.productSlug, board.slug),
          input.origin,
        )})`,
      );
    }
    lines.push("");
  }

  if (helpPage && helpPage.collections.length > 0) {
    lines.push(
      "## Help",
      "",
      `- [Help center](${absolute(
        publicHelpPath(tenant.workspaceSlug, tenant.productSlug),
        input.origin,
      )})`,
    );
    for (const collection of helpPage.collections) {
      lines.push(
        `- [${collection.name}](${absolute(
          publicHelpCollectionPath(
            tenant.workspaceSlug,
            tenant.productSlug,
            collection.slug,
          ),
          input.origin,
        )})`,
      );
      for (const article of collection.articles) {
        lines.push(
          `  - [${article.title}](${absolute(
            publicHelpArticlePath(
              tenant.workspaceSlug,
              tenant.productSlug,
              collection.slug,
              article.slug,
            ),
            input.origin,
          )})`,
        );
      }
    }
    lines.push("");
  }

  if (apiDocsPage && apiDocsPage.docs.length > 0) {
    lines.push(
      "## API documentation",
      "",
      `- [API docs](${absolute(
        publicApiDocsPath(tenant.workspaceSlug, tenant.productSlug),
        input.origin,
      )})`,
    );
    for (const doc of apiDocsPage.docs) {
      lines.push(
        `- [${doc.name} v${doc.version}](${absolute(
          publicApiDocPath(tenant.workspaceSlug, tenant.productSlug, doc.slug),
          input.origin,
        )})${doc.description ? ` — ${doc.description}` : ""}`,
      );
    }
    lines.push("");
  }

  if (requestRows.length > 0) {
    lines.push("## Public requests", "");
    for (const request of requestRows) {
      lines.push(
        `- [${request.title}](${absolute(
          publicRequestPath(
            tenant.workspaceSlug,
            tenant.productSlug,
            request.boardSlug,
            request.id,
          ),
          input.origin,
        )}) — ${request.status}, ${request.boardName}. ${excerpt(request.body, 180)}`,
      );
    }
    lines.push("");
  }

  if (roadmapRows.length > 0) {
    lines.push("## Roadmaps", "");
    for (const roadmap of roadmapRows) {
      lines.push(
        `- [${roadmap.name}](${absolute(
          publicRoadmapPath(
            tenant.workspaceSlug,
            tenant.productSlug,
            roadmap.slug,
          ),
          input.origin,
        )})`,
      );
    }
    lines.push("");
  }

  if (releaseRows.length > 0) {
    lines.push("## Updates", "");
    for (const release of releaseRows) {
      lines.push(
        `- [${release.title}](${absolute(
          publicChangelogEntryPath(
            tenant.workspaceSlug,
            tenant.productSlug,
            release.slug,
          ),
          input.origin,
        )})${release.publishedAt ? ` — ${release.publishedAt.toISOString().slice(0, 10)}` : ""}. ${release.summary}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Machine-readable",
    "",
    `- Sitemap: ${absolute("/sitemap.xml", input.origin)}`,
    `- Changelog: ${
      tenant.publicChangelogEnabled
        ? absolute(
            publicChangelogPath(tenant.workspaceSlug, tenant.productSlug),
            input.origin,
          )
        : "not published"
    }`,
    `- Help: ${absolute(
      publicHelpPath(tenant.workspaceSlug, tenant.productSlug),
      input.origin,
    )}`,
    `- API docs: ${absolute(
      publicApiDocsPath(tenant.workspaceSlug, tenant.productSlug),
      input.origin,
    )}`,
    "",
  );

  return lines.join("\n");
}
