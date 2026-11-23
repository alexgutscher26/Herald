import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  Megaphone,
  ChevronRight,
  Rss,
  Tag,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { TagChip } from "@/components/shared/feedback-primitives";
import { Markdown } from "@/components/shared/markdown";
import { ReleaseCover } from "@/components/shared/release-cover";
import { ReleaseCategoryBadge } from "@/components/shared/status-badge";
import { YouTubeEmbed } from "@/components/shared/youtube-embed";
import { Button } from "@/components/ui/button";

import { formatPublicDate } from "./i18n";
import { translatedRelease } from "@/features/i18n/content";
import { getPublicSite } from "./i18n/server";
import { JsonLd } from "./json-ld";
import { articleSchema } from "./structured-data";
import { absolutePublicUrl } from "./urls";
import {
  publicBoardPath,
  publicChangelogCategoryPath,
  publicChangelogCategoryRssPath,
  publicChangelogEntryPath,
  publicChangelogPath,
  publicChangelogRssPath,
  publicChangelogTagPath,
  publicChangelogTagRssPath,
  publicLoginPath,
  publicRequestPath,
  publicRoadmapPath,
} from "./paths";
import { PublicHeader } from "./public-header";
import { ReactionBar } from "./request-actions";
import { ShareLinks } from "./share-links";
import type {
  PublicChangelogDetailPage,
  PublicChangelogPage,
  PublicChangelogSummary,
  PublicReleaseCategory,
} from "./types";
import type { PublicViewerIdentity } from "./viewer";
import { slugify } from "@/lib/slug";

const CATEGORIES: PublicReleaseCategory[] = ["feature", "improvement", "fix"];

function categoryLabelKey(category: PublicReleaseCategory) {
  return category === "feature"
    ? ("updates.category.feature" as const)
    : category === "improvement"
      ? ("updates.category.improvement" as const)
      : ("updates.category.fix" as const);
}

function SurfaceLinks({
  workspaceSlug,
  productSlug,
  boardSlug,
  roadmapEnabled,
  active,
  labels,
}: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string | null;
  roadmapEnabled: boolean;
  active: "feedback" | "roadmap" | "changelog";
  labels: { feedback: string; roadmap: string; changelog: string };
}) {
  const items = [
    boardSlug
      ? {
          key: "feedback" as const,
          href: publicBoardPath(workspaceSlug, productSlug, boardSlug),
          label: labels.feedback,
        }
      : null,
    roadmapEnabled
      ? {
          key: "roadmap" as const,
          href: publicRoadmapPath(workspaceSlug, productSlug),
          label: labels.roadmap,
        }
      : null,
    {
      key: "changelog" as const,
      href: publicChangelogPath(workspaceSlug, productSlug),
      label: labels.changelog,
    },
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <nav aria-label={labels.changelog} className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
            item.key === active
              ? "border-primary/30 bg-primary/10 text-primary"
              : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function ChangelogCard({
  entry,
  href,
  locale,
  translationEnabled,
  readLabel,
  tagHref,
  categoryHref,
}: {
  entry: PublicChangelogSummary;
  href: string;
  locale: Parameters<typeof formatPublicDate>[0];
  translationEnabled: boolean;
  readLabel: string;
  tagHref: (tag: string) => string;
  categoryHref: string;
}) {
  const copy = translatedRelease(entry, locale, translationEnabled);
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <ReleaseCover
          cover={entry.cover}
          accentColor="#4f46e5"
          productInitial={copy.title.charAt(0)}
          className="h-24 w-full sm:h-28"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={categoryHref}>
              <ReleaseCategoryBadge category={entry.category} />
            </Link>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatPublicDate(locale, entry.publishedAt)}
            </span>
          </div>
          <h2 className="mt-2 break-words text-lg font-semibold leading-snug text-foreground">
            <Link href={href} className="hover:text-primary">
              {copy.title}
            </Link>
          </h2>
          <p className="mt-1 line-clamp-3 break-words text-sm text-muted-foreground">
            {copy.summary}
          </p>
          {entry.tags.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <li key={tag}>
                  <Link href={tagHref(tag)} aria-label={tag}>
                    <TagChip name={tag} color={null} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="size-3.5" aria-hidden="true" />
              {entry.authors.length > 0
                ? entry.authors.map((author) => author.name).join(", ")
                : "Team"}
            </p>
            <Link
              href={href}
              className="inline-flex min-h-6 items-center gap-1 py-0.5 text-sm font-medium text-primary hover:underline"
            >
              {readLabel}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

export async function PublicChangelogView({
  page,
  viewer,
}: {
  page: PublicChangelogPage;
  viewer: PublicViewerIdentity | null;
}) {
  const site = await getPublicSite(page.workspace.slug);
  const { t, locale } = site;
  const changelogPath = publicChangelogPath(page.workspace.slug, page.product.slug);
  const filterBasePath =
    page.filter?.kind === "tag"
      ? publicChangelogTagPath(page.workspace.slug, page.product.slug, page.filter.tag.slug)
      : page.filter?.kind === "category"
        ? publicChangelogCategoryPath(
            page.workspace.slug,
            page.product.slug,
            page.filter.category,
          )
        : changelogPath;
  const rssPath =
    page.filter?.kind === "tag"
      ? publicChangelogTagRssPath(page.workspace.slug, page.product.slug, page.filter.tag.slug)
      : page.filter?.kind === "category"
        ? publicChangelogCategoryRssPath(
            page.workspace.slug,
            page.product.slug,
            page.filter.category,
          )
        : publicChangelogRssPath(page.workspace.slug, page.product.slug);
  const tagHref = (tag: string) =>
    publicChangelogTagPath(page.workspace.slug, page.product.slug, slugify(tag));
  const boardPath = page.boardSlug
    ? publicBoardPath(page.workspace.slug, page.product.slug, page.boardSlug)
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={viewer}
        homeHref={boardPath ?? changelogPath}
        nextPath={changelogPath}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <SurfaceLinks
          workspaceSlug={page.workspace.slug}
          productSlug={page.product.slug}
          boardSlug={page.boardSlug}
          roadmapEnabled={page.roadmapEnabled}
          active="changelog"
          labels={{
            feedback: t("roadmap.viewFeedback"),
            roadmap: t("roadmap.nav"),
            changelog: t("updates.nav"),
          }}
        />

        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {page.filter?.kind === "tag"
                ? t("updates.filterTag", { tag: page.filter.tag.name })
                : page.filter?.kind === "category"
                  ? t("updates.filterCategory", {
                      category: t(categoryLabelKey(page.filter.category)),
                    })
                  : t("updates.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {page.product.description?.trim() ||
                t("updates.subtitle", { product: page.product.name })}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={rssPath}>
              <Rss aria-hidden="true" />
              {t("updates.rss")}
            </a>
          </Button>
        </div>

        {page.filter ? (
          <Link
            href={changelogPath}
            className="mt-3 inline-flex min-h-6 items-center gap-1.5 py-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            {t("updates.clearFilter")}
          </Link>
        ) : null}

        <nav aria-label={t("updates.filterNav")} className="mt-4 flex flex-wrap gap-1.5">
          {CATEGORIES.map((category) => {
            const active = page.filter?.kind === "category" && page.filter.category === category;
            return (
              <Link
                key={category}
                href={publicChangelogCategoryPath(page.workspace.slug, page.product.slug, category)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                  active
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t(categoryLabelKey(category))}
              </Link>
            );
          })}
        </nav>

        {page.entries.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={Megaphone}
            title={t("updates.emptyTitle")}
            description={t("updates.emptyBody")}
          />
        ) : (
          <>
            <ol className="mt-6 space-y-3">
              {page.entries.map((entry) => (
                <li key={entry.id}>
                  <ChangelogCard
                    entry={entry}
                    href={publicChangelogEntryPath(
                      page.workspace.slug,
                      page.product.slug,
                      entry.slug,
                    )}
                    locale={locale}
                    translationEnabled={site.contentTranslationEnabled}
                    readLabel={t("updates.readUpdate")}
                    tagHref={tagHref}
                    categoryHref={publicChangelogCategoryPath(
                      page.workspace.slug,
                      page.product.slug,
                      entry.category,
                    )}
                  />
                </li>
              ))}
            </ol>

            {page.pagination.totalPages > 1 ? (
              <nav
                aria-label={t("updates.paginationNav")}
                className="mt-6 flex flex-col items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex-row"
              >
                <p>
                  {t("updates.pageOf", {
                    page: page.pagination.page,
                    pages: page.pagination.totalPages,
                  })}
                </p>
                <div className="flex items-center gap-2">
                  {page.pagination.page > 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`${filterBasePath}?page=${page.pagination.page - 1}`} rel="prev">
                        <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
                        {t("updates.previous")}
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
                      {t("updates.previous")}
                    </Button>
                  )}
                  {page.pagination.page < page.pagination.totalPages ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`${filterBasePath}?page=${page.pagination.page + 1}`} rel="next">
                        {t("updates.next")}
                        <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      {t("updates.next")}
                      <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </nav>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

export async function PublicChangelogEntryView({
  page,
  path,
  viewer,
}: {
  page: PublicChangelogDetailPage;
  path: string;
  viewer: PublicViewerIdentity | null;
}) {
  const site = await getPublicSite(page.workspace.slug);
  const { t, locale } = site;
  const changelogPath = publicChangelogPath(page.workspace.slug, page.product.slug);
  const boardPath = page.boardSlug
    ? publicBoardPath(page.workspace.slug, page.product.slug, page.boardSlug)
    : null;
  const { entry } = page;
  const copy = translatedRelease(entry, locale, site.contentTranslationEnabled);

  return (
    <div className="flex min-h-screen flex-col">
      <JsonLd
        data={articleSchema({
          headline: copy.title,
          description: copy.summary,
          path,
          datePublished: entry.publishedAt,
          authorNames: entry.authors.map((author) => author.name),
          imageUrl: entry.ogImageUrl ? absolutePublicUrl(entry.ogImageUrl) : null,
          section: entry.category,
          keywords: entry.tags,
          publisherName: page.workspace.name,
        })}
      />
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={viewer}
        homeHref={boardPath ?? changelogPath}
        nextPath={path}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <SurfaceLinks
          workspaceSlug={page.workspace.slug}
          productSlug={page.product.slug}
          boardSlug={page.boardSlug}
          roadmapEnabled={page.roadmapEnabled}
          active="changelog"
          labels={{
            feedback: t("roadmap.viewFeedback"),
            roadmap: t("roadmap.nav"),
            changelog: t("updates.nav"),
          }}
        />

        <Link
          href={changelogPath}
          className="mt-4 inline-flex min-h-6 items-center gap-1.5 py-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {t("updates.back")}
        </Link>

        <article className="mt-5">
          <ReleaseCover
            cover={entry.cover}
            accentColor="#4f46e5"
            productInitial={copy.title.charAt(0)}
            className="h-48 w-full sm:h-64"
          />

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <ReleaseCategoryBadge category={entry.category} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {t("updates.publishedOn", {
                date: formatPublicDate(locale, entry.publishedAt),
              })}
            </span>
          </div>

          <h1 className="mt-2 break-words text-3xl font-semibold leading-tight tracking-tight text-foreground">
            {copy.title}
          </h1>
          <p className="mt-2 max-w-2xl break-words text-base leading-relaxed text-muted-foreground">
            {copy.summary}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
            <UserRound className="size-4" aria-hidden="true" />
            {entry.authors.length > 0
              ? t("updates.byline", {
                  authors: entry.authors.map((author) => author.name).join(", "),
                })
              : "Team"}
          </p>

          {entry.tags.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={publicChangelogTagPath(
                      page.workspace.slug,
                      page.product.slug,
                      slugify(tag),
                    )}
                    aria-label={tag}
                  >
                    <TagChip name={tag} color={null} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6">
            <YouTubeEmbed url={entry.youtubeUrl} title={copy.title} />
          </div>

          <div className="mt-6">
            <Markdown>{copy.body}</Markdown>
          </div>

          <section aria-labelledby="reactions-heading" className="mt-8 border-t pt-5">
            <h2 id="reactions-heading" className="text-sm font-semibold text-foreground">
              {t("updates.reactions")}
            </h2>
            <div className="mt-2">
              <ReactionBar
                endpoint={`/api/public/releases/${encodeURIComponent(entry.id)}/reactions?workspaceSlug=${encodeURIComponent(page.workspace.slug)}&productSlug=${encodeURIComponent(page.product.slug)}`}
                initial={entry.reactions}
                disabled={!entry.canReact}
                signInHref={publicLoginPath(page.workspace.slug, page.product.slug)}
              />
            </div>
          </section>

          {entry.related.length > 0 ? (
            <section aria-labelledby="related-heading" className="mt-8 border-t pt-5">
              <h2 id="related-heading" className="text-base font-semibold text-foreground">
                {t("updates.related")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("updates.relatedBody")}</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {entry.related.map((related) => (
                  <li key={related.id}>
                    <Link
                      href={publicChangelogEntryPath(
                        page.workspace.slug,
                        page.product.slug,
                        related.slug,
                      )}
                      className="group flex h-full flex-col rounded-md border bg-card p-3 hover:border-primary/30"
                    >
                      <span className="text-sm font-medium text-foreground group-hover:text-primary">
                        {related.title}
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {related.summary}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.linkedRequests.length > 0 ? (
            <section
              aria-labelledby="built-from-heading"
              className="mt-8 rounded-lg border bg-muted/20 p-4"
            >
              <h2
                id="built-from-heading"
                className="flex items-center gap-1.5 text-base font-semibold text-foreground"
              >
                <Tag className="size-4" aria-hidden="true" />
                {t("updates.builtFrom")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("updates.builtFromBody")}
              </p>
              <ul className="mt-3 space-y-2">
                {entry.linkedRequests.map((request) => (
                  <li key={request.id}>
                    <Link
                      href={publicRequestPath(
                        page.workspace.slug,
                        page.product.slug,
                        request.boardSlug,
                        request.id,
                      )}
                      className="group flex min-h-6 items-start justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm text-foreground hover:border-primary/30 hover:text-primary"
                    >
                      <span className="min-w-0 flex-1 break-words">{request.title}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {request.pending ? (
                          <span className="rounded-full border border-warning/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                            {t("updates.awaitingReview")}
                          </span>
                        ) : null}
                        <span>
                          {t(
                            request.voteCount === 1
                              ? "common.voteCount.one"
                              : "common.voteCount.other",
                            { count: request.voteCount },
                          )}
                        </span>
                        <ArrowUpRight
                          className="size-3.5 opacity-50 group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="share-heading" className="mt-8">
            <h2
              id="share-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("request.share")}
            </h2>
            <div className="mt-2">
              <ShareLinks path={path} title={copy.title} />
            </div>
          </section>
        </article>
      </main>
    </div>
  );
}
