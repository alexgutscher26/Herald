import "server-only";

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackPosts,
  releases,
  surveys,
} from "@/db/schema";
import { getPublicChangelogPage } from "@/features/public/changelog";
import { getPublicHelpIndex, searchPublicHelp } from "@/features/help/service";
import { loadAccessiblePublicBoards } from "@/features/public/access";
import { resolvePublicPortalProduct } from "@/features/public/resolver";
import { publicChangelogPath } from "@/features/public/paths";
import {
  publicExperiences,
  publicOutboundMessages,
  type ExperienceContent,
} from "@/features/engagement/service";
import {
  audienceFromTraits,
  matchesTargeting,
  parseTargetingRules,
} from "@/features/engagement/rules";
import type { PublicViewer } from "@/features/public/queries";

export type PortalSection = {
  key: "feedback" | "help" | "roadmap" | "updates" | "api";
  label: string;
  href: string;
};

export type PortalNavigation = {
  productName: string;
  productDescription: string | null;
  sections: PortalSection[];
  boardSlug: string | null;
  productPath: string;
};

export type PortalHome = PortalNavigation & {
  helpCollections: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    articleCount: number;
  }[];
  latestUpdates: {
    id: string;
    title: string;
    slug: string;
    summary: string;
    publishedAt: string;
  }[];
  boards: { id: string; name: string; slug: string; requestCount: number }[];
  /** Opt-in count of requests shipped this quarter; null when disabled. */
  shippedThisQuarter: number | null;
  activeSurveys: { id: string; name: string; slug: string; kind: string }[];
  experiences: {
    id: string;
    kind: string;
    name: string;
    content: ExperienceContent;
    audience: { type: string }[];
    defaultLocale: string;
    dismissDays: number;
  }[];
  outbound: {
    id: string;
    title: string;
    body: string;
    ctaLabel: string | null;
    ctaUrl: string | null;
  }[];
};

export async function loadPortalNavigation(input: {
  workspaceSlug: string;
  productSlug: string;
  viewerCustomerId?: string | null | undefined;
}): Promise<PortalNavigation | null> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return null;
  const productPath = `/p/${tenant.workspace.slug}/${tenant.product.slug}`;

  // The default Feedback link is the first board this visitor may actually
  // open, so a segment-gated board is never advertised to an anonymous page.
  const accessibleBoards = tenant.product.publicFeedbackEnabled
    ? await loadAccessiblePublicBoards({
        productId: tenant.product.id,
        workspaceId: tenant.workspace.id,
        viewerCustomerId: input.viewerCustomerId ?? null,
      })
    : [];
  const boardSlug = accessibleBoards[0]?.slug ?? null;

  const sections: PortalSection[] = [
    { key: "help", label: "Help", href: `${productPath}/help` },
  ];
  if (boardSlug) {
    sections.push({
      key: "feedback",
      label: "Feedback",
      href: `${productPath}/${boardSlug}`,
    });
  }
  if (tenant.product.publicRoadmapEnabled) {
    sections.push({ key: "roadmap", label: "Roadmap", href: `${productPath}/roadmap` });
  }
  if (tenant.product.publicChangelogEnabled) {
    sections.push({ key: "updates", label: "Updates", href: `${productPath}/updates` });
  }
  sections.push({ key: "api", label: "API", href: `${productPath}/docs/api` });

  return {
    productName: tenant.product.name,
    productDescription: tenant.product.description,
    sections,
    boardSlug,
    productPath,
  };
}

export async function loadPortalHome(input: {
  workspaceSlug: string;
  productSlug: string;
  viewer: PublicViewer | null;
  locale?: string | undefined;
}): Promise<PortalHome | null> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return null;
  const navigation = await loadPortalNavigation({
    ...input,
    viewerCustomerId: input.viewer?.customerId ?? null,
  });
  if (!navigation) return null;

  const quarterStart = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      Math.floor(new Date().getUTCMonth() / 3) * 3,
      1,
    ),
  );
  const [help, updates, boardRows, surveyRows, attributes, shippedRows] = await Promise.all([
    getPublicHelpIndex({ ...input, locale: input.locale }),
    tenant.product.publicChangelogEnabled
      ? getPublicChangelogPage({ ...input, pageSize: 3 })
      : Promise.resolve(null),
    tenant.product.publicFeedbackEnabled
      ? loadAccessiblePublicBoards({
          productId: tenant.product.id,
          workspaceId: tenant.workspace.id,
          viewerCustomerId: input.viewer?.customerId ?? null,
        }).then((accessible) =>
          accessible.length === 0
            ? []
            : db
                .select({
                  id: boards.id,
                  name: boards.name,
                  slug: boards.slug,
                  requestCount: sql<number>`(
                    select count(*)::int
                    from feedback_posts fp
                    left join customers c on c.id = fp.author_customer_id
                    where fp.board_id = "boards"."id"
                      and fp.product_id = ${tenant.product.id}
                      and fp.privacy = 'public'
                      and fp.hidden_at is null
                      and fp.archived_at is null
                      and fp.merged_into_id is null
                      and c.banned_at is null
                      and case
                        when (${boards.settings} #>> '{moderation,requireApproval}') = 'none'
                          then (
                            select mr.status::text from moderation_reviews mr
                            where mr.content_type = 'feedback_post'
                              and mr.content_id = fp.id
                            order by mr.created_at desc limit 1
                          ) is distinct from 'rejected'
                        else (
                            select mr.status::text from moderation_reviews mr
                            where mr.content_type = 'feedback_post'
                              and mr.content_id = fp.id
                            order by mr.created_at desc limit 1
                          ) = 'approved'
                      end
                  )`,
                })
                .from(boards)
                .where(inArray(boards.id, accessible.map((board) => board.id)))
                .orderBy(asc(boards.position), asc(boards.name))
                .limit(6),
        )
      : Promise.resolve([]),
    db
      .select({
        id: surveys.id,
        name: surveys.name,
        slug: surveys.slug,
        kind: surveys.kind,
        audience: surveys.audience,
      })
      .from(surveys)
      .where(and(eq(surveys.productId, tenant.product.id), eq(surveys.status, "active")))
      .limit(5),
    input.viewer
      ? db
          .select({ traits: customers.traits })
          .from(customers)
          .where(
            and(
              eq(customers.id, input.viewer.customerId),
              eq(customers.workspaceId, tenant.workspace.id),
            ),
          )
          .limit(1)
          .then((rows) => audienceFromTraits(rows[0]?.traits))
      : Promise.resolve({}),
    tenant.product.publicShippedCounterEnabled
      ? db.execute(sql`
          SELECT count(DISTINCT h."feedback_post_id")::int AS value
          FROM "feedback_status_history" h
          INNER JOIN "feedback_posts" p ON p."id" = h."feedback_post_id"
          WHERE h."product_id" = ${tenant.product.id}
            AND h."to_status" = 'shipped'
            AND h."changed_at" >= ${quarterStart}
            AND p."privacy" = 'public'
            AND p."hidden_at" IS NULL
            AND p."archived_at" IS NULL
        `)
      : Promise.resolve(null),
  ]);

  // The viewer's traits are read from the customer row rather than the cookie.
  // Importing the full customer service here would create a portal → session
  // cycle, so the reusable engagement services evaluate the same rules.
  const [experiences, outbound] = await Promise.all([
    input.viewer
      ? publicExperiences({
          ...input,
          visitorKey: `customer:${input.viewer.customerId}`,
          customerId: input.viewer.customerId,
        })
      : Promise.resolve([]),
    input.viewer
      ? publicOutboundMessages({
          ...input,
          customerId: input.viewer.customerId,
          context: { attributes },
          locale: input.locale,
        })
      : Promise.resolve([]),
  ]);

  // Only customer attributes are evaluated here. A page/event rule decides
  // when the widget prompts; it must not hide the survey from the portal.
  const visibleSurveys = surveyRows.filter((row) =>
    matchesTargeting(
      parseTargetingRules(row.audience).filter((rule) => rule.type === "attribute"),
      { attributes },
    ),
  );

  return {
    ...navigation,
    helpCollections: (help?.collections ?? []).map((collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description,
      articleCount: collection.articles.length,
    })),
    latestUpdates: (updates?.entries ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      slug: entry.slug,
      summary: entry.summary,
      publishedAt: entry.publishedAt,
    })),
    boards: boardRows,
    shippedThisQuarter: shippedRows
      ? Number((shippedRows.rows[0] as { value?: number | string } | undefined)?.value ?? 0)
      : null,
    activeSurveys: visibleSurveys.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
    })),
    experiences,
    outbound: outbound.map((message) => ({
      id: message.id,
      title: message.title,
      body: message.body,
      ctaLabel: message.ctaLabel,
      ctaUrl: message.ctaUrl,
    })),
  };
}

export type PortalSearchResult = {
  kind: "help" | "feedback" | "update";
  id: string;
  title: string;
  excerpt: string;
  href: string;
};

export type PortalSearchPage = {
  results: PortalSearchResult[];
  productName: string;
  /** Enabled sections, used by the empty state instead of hard-coded links. */
  navigation: PortalNavigation;
  query: string;
};

async function searchFeedback(
  workspaceSlug: string,
  productSlug: string,
  productId: string,
  query: string,
  workspaceId: string,
  viewerCustomerId?: string | null,
): Promise<PortalSearchResult[]> {
  const accessible = await loadAccessiblePublicBoards({
    productId,
    workspaceId,
    viewerCustomerId,
  });
  if (accessible.length === 0) return [];
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      boardSlug: boards.slug,
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        eq(feedbackPosts.productId, productId),
        inArray(boards.id, accessible.map((board) => board.id)),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        eq(feedbackPosts.privacy, "public"),
        isNull(customers.bannedAt),
        or(ilike(feedbackPosts.title, pattern), ilike(feedbackPosts.body, pattern)),
        sql`case
          when (${boards.settings} #>> '{moderation,requireApproval}') = 'none'
            then (
              select mr.status::text from moderation_reviews mr
              where mr.content_type = 'feedback_post'
                and mr.content_id = ${feedbackPosts.id}
              order by mr.created_at desc limit 1
            ) is distinct from 'rejected'
          else (
              select mr.status::text from moderation_reviews mr
              where mr.content_type = 'feedback_post'
                and mr.content_id = ${feedbackPosts.id}
              order by mr.created_at desc limit 1
            ) = 'approved'
        end`,
      ),
    )
    .orderBy(desc(feedbackPosts.createdAt))
    .limit(8);

  return rows.map((row) => ({
    kind: "feedback" as const,
    id: row.id,
    title: row.title,
    excerpt: row.body.slice(0, 180),
    href: `/p/${workspaceSlug}/${productSlug}/${row.boardSlug}/${row.id}`,
  }));
}

async function searchUpdates(
  workspaceSlug: string,
  productSlug: string,
  productId: string,
  query: string,
): Promise<PortalSearchResult[]> {
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      summary: releases.summary,
      slug: releases.slug,
    })
    .from(releases)
    .where(
      and(
        eq(releases.productId, productId),
        eq(releases.status, "published"),
        eq(releases.channelPublicChangelog, true),
        or(ilike(releases.title, pattern), ilike(releases.summary, pattern)),
      ),
    )
    .orderBy(desc(releases.publishedAt))
    .limit(8);

  return rows.map((row) => ({
    kind: "update" as const,
    id: row.id,
    title: row.title,
    excerpt: row.summary ?? "",
    href: `${publicChangelogPath(workspaceSlug, productSlug)}/${row.slug}`,
  }));
}

export async function searchPortal(input: {
  workspaceSlug: string;
  productSlug: string;
  query: string;
  viewerCustomerId?: string | null | undefined;
  locale?: string | undefined;
}): Promise<PortalSearchPage | null> {
  const [tenant, navigation] = await Promise.all([
    resolvePublicPortalProduct(input),
    loadPortalNavigation(input),
  ]);
  if (!tenant || !navigation) return null;
  const query = input.query.trim().slice(0, 100);
  if (query.length < 2) {
    return {
      results: [],
      productName: tenant.product.name,
      navigation,
      query,
    };
  }

  const [help, feedback, updates] = await Promise.all([
    searchPublicHelp({ ...input, query }),
    tenant.product.publicFeedbackEnabled
      ? searchFeedback(
          input.workspaceSlug,
          input.productSlug,
          tenant.product.id,
          query,
          tenant.workspace.id,
          input.viewerCustomerId,
        )
      : Promise.resolve([]),
    tenant.product.publicChangelogEnabled
      ? searchUpdates(
          input.workspaceSlug,
          input.productSlug,
          tenant.product.id,
          query,
        )
      : Promise.resolve([]),
  ]);

  const helpResults: PortalSearchResult[] = (help?.hits ?? []).map((hit) => ({
    kind: "help",
    id: hit.id,
    title: hit.title,
    excerpt: hit.excerpt,
    href: `/p/${input.workspaceSlug}/${input.productSlug}/help/${hit.collectionSlug}/${hit.slug}`,
  }));

  return {
    results: [...helpResults, ...feedback, ...updates],
    productName: tenant.product.name,
    navigation,
    query,
  };
}
