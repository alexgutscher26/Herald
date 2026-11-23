import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { TagChip, VoteCountBox } from "@/components/shared/feedback-primitives";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  formatPublicDate,
  formatPublicNumber,
  type PublicLocaleCode,
  type PublicMessageKey,
  type Translate,
} from "./i18n";
import { getPublicSite } from "./i18n/server";
import {
  publicBoardPath,
  publicChangelogPath,
  publicRequestPath,
  publicRoadmapPath,
  publicSubmitPath,
} from "./paths";
import {
  PUBLIC_CATEGORY_LABELS,
  PUBLIC_STATUS_LABELS,
  PUBLIC_STATUS_TONES,
} from "./presentation";
import { PublicHeader } from "./public-header";
import type { PublicViewerIdentity } from "./viewer";
import {
  publicBoardQueryString,
  type PublicBoardQuery,
  type PublicBoardSort,
} from "./query";
import type {
  PublicBoardPage,
  PublicFeedbackStatus,
  PublicRequestSummary,
} from "./types";

/**
 * Public board presentation.
 *
 * Server-rendered and query-string driven: sorting, filtering and pagination
 * are ordinary links, so the page works without JavaScript and every state has
 * a shareable URL. It consumes only `PublicBoardPage`, whose fields are the
 * public contract — there is no dashboard snapshot or internal row in scope.
 */

const SORTS: { id: PublicBoardSort; label: PublicMessageKey }[] = [
  { id: "top", label: "board.sort.top" },
  { id: "trending", label: "board.sort.trending" },
  { id: "newest", label: "board.sort.newest" },
];

function RequestCard({
  request,
  href,
  t,
  locale,
}: {
  request: PublicRequestSummary;
  href: string;
  t: Translate;
  locale: PublicLocaleCode;
}) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex gap-3 sm:gap-4">
        <VoteCountBox
          count={request.voteCount}
          locale={locale}
          label={t("board.votesShort")}
          ariaLabel={t("board.votesAria", { count: request.voteCount })}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={PUBLIC_STATUS_TONES[request.status]} className="rounded-full text-[11px]">
              {t(PUBLIC_STATUS_LABELS[request.status])}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">
              {t(PUBLIC_CATEGORY_LABELS[request.category])}
            </span>
          </div>

          <h2 className="mt-2 break-words text-base font-semibold leading-snug text-foreground">
            <Link href={href} className="hover:text-primary">
              {request.title}
            </Link>
          </h2>
          <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm text-muted-foreground">
            {request.body}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span>{request.authorName}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={request.createdAt}>
              {formatPublicDate(locale, request.createdAt)}
            </time>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {formatPublicNumber(locale, request.commentCount)}
            </span>
            {request.tags.map((tag) => (
              <TagChip key={tag.name} name={tag.name} color={tag.color} />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export async function PublicBoardView({
  page,
  query,
  viewer,
}: {
  page: PublicBoardPage;
  query: PublicBoardQuery;
  viewer: PublicViewerIdentity | null;
}) {
  const site = await getPublicSite(page.workspace.slug);
  const { t, tc, locale } = site;

  const boardPath = publicBoardPath(
    page.workspace.slug,
    page.product.slug,
    page.board.slug,
  );
  const href = (overrides: Partial<PublicBoardQuery>) =>
    `${boardPath}${publicBoardQueryString(query, overrides)}`;

  const hasFilters =
    query.search !== "" || query.status !== null || query.tag !== null;
  const firstResult =
    page.pagination.total === 0
      ? 0
      : (page.pagination.page - 1) * page.pagination.pageSize + 1;
  const lastResult = Math.min(
    page.pagination.page * page.pagination.pageSize,
    page.pagination.total,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={viewer}
        homeHref={boardPath}
        nextPath={boardPath}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        {page.boards.length > 1 || page.roadmapEnabled || page.changelogEnabled ? (
          <nav aria-label={t("board.boardsNav")} className="mb-5 flex flex-wrap gap-2">
            {page.boards.map((board) => {
              const active = board.slug === page.board.slug;
              return (
                <Link
                  key={board.slug}
                  href={publicBoardPath(
                    page.workspace.slug,
                    page.product.slug,
                    board.slug,
                  )}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {board.name}
                </Link>
              );
            })}
            {page.roadmapEnabled ? (
              <Link
                href={publicRoadmapPath(page.workspace.slug, page.product.slug)}
                className="inline-flex items-center rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("roadmap.nav")}
              </Link>
            ) : null}
            {page.changelogEnabled ? (
              <Link
                href={publicChangelogPath(page.workspace.slug, page.product.slug)}
                className="inline-flex items-center rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("updates.nav")}
              </Link>
            ) : null}
          </nav>
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
          {page.board.icon ? (
            <span aria-hidden="true" className="text-2xl leading-none">
              {page.board.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h1
              className="text-2xl font-semibold tracking-tight text-foreground"
              style={page.board.color ? { color: page.board.color } : undefined}
            >
              {page.board.name}
            </h1>
            {page.board.description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {page.board.description}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {tc("board.requestCount.one", "board.requestCount.other", page.pagination.total)}
              {page.board.guestPosting ? ` · ${t("board.anyoneCanPost")}` : null}
            </p>
          </div>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link
              href={publicSubmitPath(
                page.workspace.slug,
                page.product.slug,
                page.board.slug,
              )}
            >
              {t("board.newRequest")}
            </Link>
          </Button>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-y py-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label={t("board.sortNav")}>
            <ul className="flex flex-wrap gap-1">
              {SORTS.map((sort) => {
                const active = query.sort === sort.id;
                return (
                  <li key={sort.id}>
                    <Link
                      href={href({ sort: sort.id, page: 1 })}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {t(sort.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <form action={boardPath} method="get" className="flex w-full gap-2 sm:w-auto">
            {query.status ? (
              <input type="hidden" name="status" value={query.status} />
            ) : null}
            {query.tag ? <input type="hidden" name="tag" value={query.tag} /> : null}
            {query.sort !== "newest" ? (
              <input type="hidden" name="sort" value={query.sort} />
            ) : null}
            {query.pageSize !== 20 ? (
              <input type="hidden" name="pageSize" value={query.pageSize} />
            ) : null}
            <label htmlFor="board-search" className="sr-only">
              {t("board.searchRequests")}
            </label>
            <Input
              id="board-search"
              name="q"
              type="search"
              defaultValue={query.search}
              placeholder={t("board.searchRequests")}
              maxLength={120}
              className="sm:w-64"
            />
            <Button type="submit" variant="outline">
              {t("board.search")}
            </Button>
          </form>
        </div>

        <div className="mt-4 space-y-3">
          <nav aria-label={t("board.statusFilter")} className="flex flex-wrap gap-1.5">
            <Link
              href={href({ status: null, page: 1 })}
              aria-current={query.status === null ? "page" : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                query.status === null
                  ? "border-foreground/30 bg-foreground text-background"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("board.allStatuses")}
            </Link>
            {(Object.keys(PUBLIC_STATUS_LABELS) as PublicFeedbackStatus[]).map((status) => {
              const active = query.status === status;
              return (
                <Link
                  key={status}
                  href={href({ status, page: 1 })}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    active
                      ? "border-foreground/30 bg-foreground text-background"
                      : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(PUBLIC_STATUS_LABELS[status])}
                </Link>
              );
            })}
          </nav>

          {page.tags.length > 0 ? (
            <nav aria-label={t("board.tagFilter")} className="flex flex-wrap gap-1.5">
              <Link
                href={href({ tag: null, page: 1 })}
                aria-current={query.tag === null ? "page" : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  query.tag === null
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("board.allTags")}
              </Link>
              {page.tags.map((tag) => {
                const active = query.tag === tag.name;
                return (
                  <Link
                    key={tag.name}
                    href={href({ tag: tag.name, page: 1 })}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                      active
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tag.color ? (
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    ) : null}
                    {tag.name}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>

        {page.requests.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={MessageSquare}
            title={hasFilters ? t("board.emptyFilteredTitle") : t("board.emptyTitle")}
            description={hasFilters ? t("board.emptyFilteredBody") : t("board.emptyBody")}
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <Link href={boardPath}>{t("board.clearFilters")}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ol className="mt-6 space-y-3" aria-label={t("board.requestsList")}>
              {page.requests.map((request) => (
                <li key={request.id}>
                  <RequestCard
                    request={request}
                    t={t}
                    locale={locale}
                    href={publicRequestPath(
                      page.workspace.slug,
                      page.product.slug,
                      page.board.slug,
                      request.id,
                    )}
                  />
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex-row">
              <p aria-live="polite">
                {t("board.range", {
                  from: firstResult,
                  to: lastResult,
                  total: page.pagination.total,
                })}
              </p>
              {page.pagination.totalPages > 1 ? (
                <nav aria-label={t("board.paginationNav")} className="flex items-center gap-2">
                  {page.pagination.page > 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={href({ page: page.pagination.page - 1 })}
                        rel="prev"
                      >
                        <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
                        {t("board.previous")}
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
                      {t("board.previous")}
                    </Button>
                  )}
                  <span className="px-1 tabular-nums">
                    {t("board.pageOf", {
                      page: page.pagination.page,
                      pages: page.pagination.totalPages,
                    })}
                  </span>
                  {page.pagination.page < page.pagination.totalPages ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={href({ page: page.pagination.page + 1 })}
                        rel="next"
                      >
                        {t("board.next")}
                        <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      {t("board.next")}
                      <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
                    </Button>
                  )}
                </nav>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
