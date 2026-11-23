import Link from "next/link";

import { VoteCountBox } from "@/components/shared/feedback-primitives";
import { Button } from "@/components/ui/button";

import { getPublicSite } from "./i18n/server";
import type { PublicMessageKey } from "./i18n";
import {
  publicBoardPath,
  publicChangelogPath,
  publicRequestPath,
  publicRoadmapPath,
} from "./paths";
import { PublicHeader } from "./public-header";
import type {
  PublicRoadmapPage,
  PublicRoadmapStatus,
} from "./types";
import type { PublicViewerIdentity } from "./viewer";

const COLUMN_COPY: Record<
  PublicRoadmapStatus,
  {
    label: PublicMessageKey;
    hint: PublicMessageKey;
    empty: PublicMessageKey;
  }
> = {
  planned: {
    label: "roadmap.planned",
    hint: "roadmap.plannedHint",
    empty: "roadmap.emptyPlanned",
  },
  in_progress: {
    label: "roadmap.inProgress",
    hint: "roadmap.inProgressHint",
    empty: "roadmap.emptyInProgress",
  },
  shipped: {
    label: "roadmap.done",
    hint: "roadmap.doneHint",
    empty: "roadmap.emptyDone",
  },
};

/**
 * Public roadmap.
 *
 * Server-rendered and read-only: there is no JavaScript needed to browse it,
 * and the cards are a projection of feedback status. When public feedback is
 * off the roadmap still renders, but cards are plain text instead of links to
 * pages that would 404.
 */
export async function PublicRoadmapView({
  page,
  viewer,
}: {
  page: PublicRoadmapPage;
  viewer: PublicViewerIdentity | null;
}) {
  const site = await getPublicSite(page.workspace.slug);
  const { t, locale } = site;
  const roadmapPath = publicRoadmapPath(
    page.workspace.slug,
    page.product.slug,
    page.roadmap.slug,
  );
  const boardPath = page.firstBoard
    ? publicBoardPath(page.workspace.slug, page.product.slug, page.firstBoard.slug)
    : null;
  const changelogPath = page.changelogEnabled
    ? publicChangelogPath(page.workspace.slug, page.product.slug)
    : null;
  const sortOptions = [
    {
      id: "recent" as const,
      label: t("roadmap.sortRecent"),
      href: roadmapPath,
    },
    {
      id: "votes" as const,
      label: t("roadmap.sortVotes"),
      href: `${roadmapPath}?sort=votes`,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={viewer}
        homeHref={boardPath ?? roadmapPath}
        nextPath={roadmapPath}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {page.roadmap.slug ? page.roadmap.name : t("roadmap.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {page.roadmap.description?.trim() ||
                page.product.description?.trim() ||
                t("roadmap.subtitle", { product: page.product.name })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {boardPath ? (
              <Button asChild variant="outline" size="sm">
                <Link href={boardPath}>{t("roadmap.viewFeedback")}</Link>
              </Button>
            ) : null}
            {changelogPath ? (
              <Button asChild variant="outline" size="sm">
                <Link href={changelogPath}>{t("updates.nav")}</Link>
              </Button>
            ) : null}
          </div>
        </div>

        <nav
          aria-label={t("roadmap.sortNav")}
          className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3"
        >
          <span className="text-xs text-muted-foreground">
            {t("roadmap.sortLabel")}
          </span>
          {sortOptions.map((option) => (
            <Link
              key={option.id}
              href={option.href}
              aria-current={page.sort === option.id ? "true" : undefined}
              className={
                page.sort === option.id
                  ? "rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  : "rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>

        {page.roadmaps.length > 1 ? (
          <nav
            aria-label={t("roadmap.views")}
            className="mt-3 flex flex-wrap gap-2 border-t pt-3"
          >
            {page.roadmaps.map((roadmap) => (
              <Link
                key={roadmap.slug}
                href={publicRoadmapPath(page.workspace.slug, page.product.slug, roadmap.slug)}
                aria-current={page.roadmap.slug === roadmap.slug ? "page" : undefined}
                className={
                  page.roadmap.slug === roadmap.slug
                    ? "rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    : "rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                {roadmap.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {page.columns.map((column) => {
            const copy = COLUMN_COPY[column.status];
            const headingId = `roadmap-${column.status}`;

            return (
              <section
                key={column.status}
                aria-labelledby={headingId}
                className="rounded-lg border bg-muted/20 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 id={headingId} className="text-sm font-semibold text-foreground">
                    {t(copy.label)}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {column.requests.length}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t(copy.hint)}
                </p>

                {column.requests.length === 0 ? (
                  <p className="mt-3 rounded-md border border-dashed bg-card px-3 py-8 text-center text-sm text-muted-foreground">
                    {t(copy.empty)}
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {column.requests.map((request) => (
                      <li key={request.id}>
                        <article className="rounded-lg border bg-card p-3 shadow-sm">
                          <div className="flex gap-3">
                            <VoteCountBox
                              count={request.voteCount}
                              locale={locale}
                              label={t("board.votesShort")}
                              ariaLabel={t("roadmap.votesAria", {
                                count: request.voteCount,
                                title: request.title,
                              })}
                            />
                            <div className="min-w-0 flex-1">
                              <h3 className="break-words text-sm font-medium leading-snug text-foreground">
                                {boardPath ? (
                                  <Link
                                    href={publicRequestPath(
                                      page.workspace.slug,
                                      page.product.slug,
                                      request.boardSlug,
                                      request.id,
                                    )}
                                    className="hover:text-primary"
                                  >
                                    {request.title}
                                  </Link>
                                ) : (
                                  request.title
                                )}
                              </h3>
                              {boardPath ? (
                                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                  {request.boardName}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
