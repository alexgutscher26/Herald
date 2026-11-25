import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  MessageSquare,
  Paperclip,
  Tag,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { TagChip } from "@/components/shared/feedback-primitives";
import { Markdown } from "@/components/shared/markdown";
import { ReleaseCover } from "@/components/shared/release-cover";
import {
  ReleaseCategoryBadge,
  StatusBadge,
} from "@/components/shared/status-badge";
import { YouTubeEmbed } from "@/components/shared/youtube-embed";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadCustomerThreads } from "@/features/conversations/customer";
import type { PublicInbox } from "@/features/notifications/inbox";
import { hasCommentAnchor } from "@/features/notifications/links";
import { MarkAllReadButton } from "@/features/public/mark-all-read-button";
import { CommentForm } from "@/features/public/comment-form";
import { formatPublicDate } from "@/features/public/i18n";
import type { PublicLocaleCode, Translate } from "@/features/public/i18n";
import { IdentifyForm } from "@/features/public/identify-form";
import {
  publicLoginPath,
  publicRequestPath,
} from "@/features/public/paths";
import {
  PUBLIC_CATEGORY_LABELS,
  PUBLIC_STATUS_LABELS,
  PUBLIC_STATUS_TONES,
} from "@/features/public/presentation";
import {
  FollowButton,
  ReactionBar,
  VoteButton,
} from "@/features/public/request-actions";
import { ShareLinks } from "@/features/public/share-links";
import { SubmitForm } from "@/features/public/submit-form";
import type {
  PublicBoardPage,
  PublicChangelogDetailPage,
  PublicChangelogPage,
  PublicRequestPage,
  PublicRoadmapPage,
  PublicSubmitPage,
} from "@/features/public/types";

import { translatedRelease } from "@/features/i18n/content";
import {
  widgetEmbedHref,
  widgetRouteFromPublicPath,
  type WidgetQuery,
} from "./paths";
import { WidgetCloseButton } from "./frame-bridge";
import {
  WidgetFeedbackView,
  type WidgetFeedbackRow,
} from "./feedback-view";
import { WidgetHomeView, type WidgetHomeAction } from "./home-view";
import { WidgetMessagesView } from "./messages-view";
import type { WidgetSection } from "./policy";
import { WidgetWhatsNewView } from "./whats-new-view";
import type { WidgetShell } from "./service";
import { WidgetEmpty } from "./shell";

/**
 * Panel bodies.
 *
 * Every component consumes the same public DTOs as the full site. There is no
 * widget-only query and no dashboard snapshot in scope, so hiding a request,
 * closing a board, turning off the changelog or changing a status takes effect
 * on the next iframe render just as it does on the public pages.
 */

function commentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

function requestApiBase(page: PublicRequestPage): string {
  return `/api/public/boards/${encodeURIComponent(
    page.workspace.slug,
  )}/${encodeURIComponent(page.product.slug)}/${encodeURIComponent(
    page.board.slug,
  )}/requests/${encodeURIComponent(page.request.id)}`;
}

function panelHref(
  shell: WidgetShell,
  route: Parameters<typeof widgetEmbedHref>[2],
  query: WidgetQuery,
): string {
  return widgetEmbedHref(shell.workspace.slug, shell.product.slug, route, query);
}

function RequestRow({
  shell,
  request,
  boardSlug,
  locale,
  t,
  query,
}: {
  shell: WidgetShell;
  request: PublicBoardPage["requests"][number];
  boardSlug: string;
  locale: PublicLocaleCode;
  t: Translate;
  query: WidgetQuery;
}) {
  return (
    <article className="rounded-lg border bg-card p-3 transition-[border-color,box-shadow] duration-200 ease-out hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 rounded-md border bg-muted/40 px-1.5 py-1 text-center text-[11px] font-semibold tabular-nums text-foreground">
          {request.voteCount}
          <span className="block text-[9px] font-normal uppercase tracking-wide text-muted-foreground">
            {t("board.votesShort")}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              tone={PUBLIC_STATUS_TONES[request.status]}
              className="rounded-full text-[10px]"
            >
              {t(PUBLIC_STATUS_LABELS[request.status])}
            </StatusBadge>
            <span className="text-[11px] text-muted-foreground">
              {t(PUBLIC_CATEGORY_LABELS[request.category])}
            </span>
          </div>
          <h3 className="mt-1.5 break-words text-sm font-semibold leading-snug">
            <Link
              href={panelHref(
                shell,
                {
                  view: "feedback",
                  boardSlug,
                  requestId: request.id,
                },
                query,
              )}
              className="hover:text-primary"
            >
              {request.title}
            </Link>
          </h3>
          <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
            {request.body}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{request.authorName}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={request.createdAt}>
              {formatPublicDate(locale, request.createdAt)}
            </time>
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare className="size-3" aria-hidden="true" />
              {request.commentCount}
            </span>
            {request.tags.slice(0, 2).map((tag) => (
              <TagChip key={tag.name} name={tag.name} color={tag.color} />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function WidgetHomePanel({
  shell,
  board,
  updates,
  t,
  locale,
  translationEnabled,
  query,
}: {
  shell: WidgetShell;
  board: PublicBoardPage | null;
  updates: PublicChangelogPage | null;
  t: Translate;
  locale: PublicLocaleCode;
  translationEnabled: boolean;
  query: WidgetQuery;
}) {
  const newRequestHref = board
    ? panelHref(
        shell,
        { view: "feedback", boardSlug: board.board.slug, compose: true },
        query,
      )
    : null;
  const feedbackHref = board
    ? panelHref(shell, { view: "feedback", boardSlug: board.board.slug }, query)
    : null;
  const latestUpdate = updates?.entries[0] ?? null;
  const latestCopy = latestUpdate
    ? translatedRelease(latestUpdate, locale, translationEnabled)
    : null;

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-lg font-semibold tracking-tight">
          {t("widget.homeTitle", { product: shell.product.name })}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t("widget.homeBody")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {newRequestHref ? (
            <Button asChild size="sm">
              <Link href={newRequestHref}>{t("board.newRequest")}</Link>
            </Button>
          ) : null}
          {feedbackHref ? (
            <Button asChild variant="outline" size="sm">
              <Link href={feedbackHref}>{t("widget.viewFeedback")}</Link>
            </Button>
          ) : null}
          {shell.viewer?.identified && shell.unread > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={panelHref(shell, { view: "notifications" }, query)}
              >
                {t("notifications.bellWithUnread", { count: shell.unread })}
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      {latestUpdate ? (
        <section aria-labelledby="widget-latest-update">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="widget-latest-update"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("widget.latestUpdate")}
            </h2>
            <Link
              href={panelHref(shell, { view: "updates", slug: null }, query)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("widget.viewUpdates")}
            </Link>
          </div>
          <article className="mt-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <ReleaseCategoryBadge category={latestUpdate.category} />
              <span className="text-[11px] text-muted-foreground">
                {formatPublicDate(locale, latestUpdate.publishedAt)}
              </span>
            </div>
            <h3 className="mt-1.5 text-sm font-semibold leading-snug">
              <Link
                href={panelHref(
                  shell,
                  { view: "updates", slug: latestUpdate.slug },
                  query,
                )}
                className="hover:text-primary"
              >
                {latestCopy?.title ?? latestUpdate.title}
              </Link>
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {latestCopy?.summary ?? latestUpdate.summary}
            </p>
          </article>
        </section>
      ) : null}

      {board && board.requests.length > 0 ? (
        <section aria-labelledby="widget-top-feedback">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="widget-top-feedback"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("widget.feedback")}
            </h2>
            {feedbackHref ? (
              <Link
                href={feedbackHref}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t("widget.viewFeedback")}
              </Link>
            ) : null}
          </div>
          <ol className="mt-2 space-y-2">
            {board.requests.slice(0, 3).map((request) => (
              <li key={request.id}>
                <RequestRow
                  shell={shell}
                  request={request}
                  boardSlug={board.board.slug}
                  locale={locale}
                  t={t}
                  query={query}
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="rounded-lg border bg-muted/20 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("widget.explore")}
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {shell.panels.roadmap ? (
            <li>
              <Link
                href={panelHref(shell, { view: "roadmap" }, query)}
                className="inline-flex min-h-6 items-center gap-1 py-0.5 font-medium text-foreground hover:text-primary"
              >
                {t("roadmap.nav")}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          ) : null}
          {shell.panels.updates ? (
            <li>
              <Link
                href={panelHref(shell, { view: "updates", slug: null }, query)}
                className="inline-flex min-h-6 items-center gap-1 py-0.5 font-medium text-foreground hover:text-primary"
              >
                {t("updates.nav")}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          ) : null}
          <li>
            <Link
              href={panelHref(shell, { view: "notifications" }, query)}
              className="inline-flex min-h-6 items-center gap-1 py-0.5 font-medium text-foreground hover:text-primary"
            >
              {t("notifications.title")}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

export function WidgetFeedbackPanel({
  shell,
  page,
  t,
  locale,
  query,
}: {
  shell: WidgetShell;
  page: PublicBoardPage | null;
  t: Translate;
  locale: PublicLocaleCode;
  query: WidgetQuery;
}) {
  if (!page) {
    return (
      <WidgetEmpty
        title={t("widget.noFeedbackTitle")}
        body={t("widget.noFeedbackBody")}
      />
    );
  }

  const rows: WidgetFeedbackRow[] = page.requests.map((request) => ({
    id: request.id,
    title: request.title,
    body: request.body,
    authorName: request.authorName,
    status: request.status,
    voteCount: request.voteCount,
    votesAria: t("board.votesAria", { count: request.voteCount }),
    createdAt: request.createdAt,
    href: panelHref(
      shell,
      {
        view: "feedback",
        boardSlug: page.board.slug,
        requestId: request.id,
      },
      query,
    ),
  }));

  const submitHref = panelHref(
    shell,
    { view: "feedback", boardSlug: page.board.slug, compose: true },
    query,
  );

  return (
    <WidgetFeedbackView
      rows={rows}
      locale={locale}
      submitHref={submitHref}
      labels={{
        title: t("widget.feedbackTitle"),
        search: t("widget.feedbackSearch"),
        noResults: t("widget.feedbackNoResults"),
        noMatches: t("widget.feedbackNoMatches"),
        searchHint: t("widget.feedbackSearchHint"),
        filterHint: t("widget.feedbackFilterHint"),
        filters: t("widget.feedbackFilters"),
        sortSection: t("widget.feedbackSortSection"),
        statusSection: t("widget.feedbackStatusSection"),
        sortTop: t("widget.feedbackSortTop"),
        sortNew: t("widget.feedbackSortNew"),
        sortTrending: t("widget.feedbackSortTrending"),
        statuses: {
          open: t("widget.feedbackStatusPending"),
          under_review: t("widget.feedbackStatusReview"),
          planned: t("widget.feedbackStatusPlanned"),
          in_progress: t("widget.feedbackStatusProgress"),
          shipped: t("widget.feedbackStatusCompleted"),
          closed: t("widget.feedbackStatusClosed"),
        },
        submit: t("widget.feedbackSubmit"),
        list: t("widget.feedbackList"),
        emptyTitle: t("board.emptyTitle"),
        emptyBody: t("board.emptyBody"),
      }}
    />
  );
}

export function WidgetComposePanel({
  shell,
  page,
  t,
  query,
  hostOrigin,
}: {
  shell: WidgetShell;
  page: PublicSubmitPage | null;
  t: Translate;
  query: WidgetQuery;
  hostOrigin: string | null;
}) {
  if (!page) {
    return (
      <WidgetEmpty
        title={t("widget.noFeedbackTitle")}
        body={t("widget.noFeedbackBody")}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 -mx-4 -mt-2 flex items-center gap-1 bg-background px-3 py-2">
        <Link
          href={panelHref(
            shell,
            { view: "feedback", boardSlug: page.board.slug },
            query,
          )}
          aria-label={t("widget.feedbackComposeBack")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-5" strokeWidth={2} aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight">
          {t("widget.feedbackComposeTitle")}
        </h1>
        <WidgetCloseButton
          hostOrigin={hostOrigin}
          label={t("widget.close")}
        />
      </header>

      <div className="flex flex-1 flex-col pt-2">
        <SubmitForm
          workspaceSlug={page.workspace.slug}
          productSlug={page.product.slug}
          boardSlug={page.board.slug}
          boards={page.boards}
          customFields={page.customFields}
          intakeQuestions={page.intakeQuestions}
          aiRewriteEnabled={page.aiRewriteEnabled}
          guestPosting={page.board.guestPosting}
          identified={page.viewer.identified}
          hasCompany={page.viewer.hasCompany}
          mode="embed"
          widgetQuery={query}
        />
      </div>
    </div>
  );
}

export function WidgetRequestPanel({
  shell,
  page,
  t,
  locale,
  query,
  submitted,
}: {
  shell: WidgetShell;
  page: PublicRequestPage;
  t: Translate;
  locale: PublicLocaleCode;
  query: WidgetQuery;
  submitted: "published" | "awaiting_review" | null;
}) {
  const { request, board } = page;
  const requestApi = requestApiBase(page);
  const needsIdentity = !board.guestPosting && !request.viewer.identified;
  const publicCommentCount = request.comments.filter(
    (comment) => !comment.pending,
  ).length;

  return (
    <div className="space-y-4">
      <Link
        href={panelHref(
          shell,
          { view: "feedback", boardSlug: board.slug },
          query,
        )}
        className="inline-flex min-h-6 items-center gap-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {board.name}
      </Link>

      {submitted === "published" ? (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-xs text-success"
        >
          {t("request.liveReceipt")}
        </p>
      ) : null}
      {request.visibility === "awaiting_review" ? (
        <div
          role="status"
          className="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-xs text-warning"
        >
          <p className="font-medium">{t("request.awaitingTitle")}</p>
          <p className="mt-1">{t("request.awaitingBody")}</p>
        </div>
      ) : null}

      <article>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            tone={PUBLIC_STATUS_TONES[request.status]}
            className="rounded-full text-[10px]"
          >
            {t(PUBLIC_STATUS_LABELS[request.status])}
          </StatusBadge>
          <span className="text-[11px] text-muted-foreground">
            {t(PUBLIC_CATEGORY_LABELS[request.category])}
          </span>
        </div>
        <h1 className="mt-1.5 break-words text-lg font-semibold leading-snug">
          {request.title}
        </h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {request.authorName} · {formatPublicDate(locale, request.createdAt)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <VoteButton
            requestApiBase={requestApi}
            initialVoted={request.viewer.hasVoted}
            initialCount={request.voteCount}
          />
          <FollowButton
            requestApiBase={requestApi}
            initialFollows={request.viewer.follows}
          />
        </div>

        <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed">
          {request.body}
        </p>

        {request.attachments.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {request.attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.isImage ? (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.url}
                      alt={attachment.fileName}
                      className="max-h-56 w-auto rounded border"
                    />
                  </a>
                ) : null}
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-6 max-w-full items-center gap-1 break-all py-0.5 text-xs text-primary hover:underline"
                >
                  <Paperclip className="size-3.5" aria-hidden="true" />
                  {attachment.fileName}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {request.tags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {request.tags.map((tag) => (
              <li key={tag.name}>
                <TagChip name={tag.name} color={tag.color} />
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4">
          <ReactionBar requestApiBase={requestApi} initial={request.reactions} />
        </div>
      </article>

      <section
        aria-labelledby="widget-discussion"
        className="space-y-2 border-t border-border/70 pt-4"
      >
        <h2
          id="widget-discussion"
          className="flex items-center gap-1.5 text-[13px] font-semibold"
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {t("request.discussion")}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {publicCommentCount}
          </span>
        </h2>
        {request.comments.length === 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-3">
            <MessageSquare
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70"
              aria-hidden="true"
            />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {t("request.noComments")}
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {request.comments.map((comment) => (
              <li
                key={comment.id}
                id={`comment-${comment.id}`}
                className={cn(
                  "flex scroll-mt-20 gap-2.5 rounded-xl border p-3 target:ring-2 target:ring-ring/50",
                  comment.pending
                    ? "border-warning/30 bg-warning-muted/40"
                    : "border-border/70 bg-card",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                >
                  {commentInitials(comment.authorName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {comment.authorName}
                    </span>
                    {comment.authorType === "team" ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-primary">
                        {t("common.team")}
                      </span>
                    ) : null}
                    <time dateTime={comment.createdAt}>
                      {formatPublicDate(locale, comment.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed">
                    {comment.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {!board.acceptsComments ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-2.5 text-[11px] text-muted-foreground">
            {t("request.commentsClosed")}
          </p>
        ) : needsIdentity ? (
          <div className="pt-1">
            <IdentifyForm workspaceSlug={page.workspace.slug} />
          </div>
        ) : (
          <div className="pt-1">
            <CommentForm
              requestApiBase={requestApi}
              hasCompany={page.request.viewer.hasCompany}
              variant="widget"
            />
          </div>
        )}
      </section>

      <section
        aria-labelledby="widget-share"
        className="space-y-2 border-t border-border/70 pt-4"
      >
        <h2
          id="widget-share"
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("request.share")}
        </h2>
        <ShareLinks
          path={publicRequestPath(
            page.workspace.slug,
            page.product.slug,
            board.slug,
            request.id,
          )}
          title={request.title}
          variant="widget"
        />
      </section>
    </div>
  );
}

export function WidgetRoadmapPanel({
  shell,
  page,
  t,
  query,
}: {
  shell: WidgetShell;
  page: PublicRoadmapPage | null;
  t: Translate;
  query: WidgetQuery;
}) {
  if (!page) {
    return (
      <WidgetEmpty
        title={t("widget.noRoadmapTitle")}
        body={t("widget.noRoadmapBody")}
      />
    );
  }

  const copy = {
    planned: {
      label: t("roadmap.planned"),
      hint: t("roadmap.plannedHint"),
      empty: t("roadmap.emptyPlanned"),
    },
    in_progress: {
      label: t("roadmap.inProgress"),
      hint: t("roadmap.inProgressHint"),
      empty: t("roadmap.emptyInProgress"),
    },
    shipped: {
      label: t("roadmap.done"),
      hint: t("roadmap.doneHint"),
      empty: t("roadmap.emptyDone"),
    },
  } as const;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold tracking-tight">
          {t("roadmap.title")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("roadmap.subtitle", { product: page.product.name })}
        </p>
      </div>
      {page.columns.map((column) => (
        <section
          key={column.status}
          aria-labelledby={`widget-roadmap-${column.status}`}
          className="rounded-lg border bg-muted/20 p-2.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2
              id={`widget-roadmap-${column.status}`}
              className="text-xs font-semibold"
            >
              {copy[column.status].label}
            </h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {column.requests.length}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {copy[column.status].hint}
          </p>
          {column.requests.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed bg-card px-2 py-4 text-center text-[11px] text-muted-foreground">
              {copy[column.status].empty}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {column.requests.map((request) => (
                <li
                  key={request.id}
                  className="rounded-md border bg-card px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-xs font-medium leading-snug">
                      {shell.panels.feedback ? (
                        <Link
                          href={panelHref(
                            shell,
                            {
                              view: "feedback",
                              boardSlug: request.boardSlug,
                              requestId: request.id,
                            },
                            query,
                          )}
                          className="hover:text-primary"
                        >
                          {request.title}
                        </Link>
                      ) : (
                        request.title
                      )}
                    </h3>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {t("board.votesAria", { count: request.voteCount })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function WidgetUpdatesPanel({
  shell,
  page,
  t,
  locale,
  translationEnabled,
  query,
}: {
  shell: WidgetShell;
  page: PublicChangelogPage | null;
  t: Translate;
  locale: PublicLocaleCode;
  translationEnabled: boolean;
  query: WidgetQuery;
}) {
  if (!page) {
    return (
      <WidgetEmpty
        title={t("updates.emptyTitle")}
        body={t("updates.emptyBody")}
      />
    );
  }

  const items = page.entries.map((entry) => {
    const copy = translatedRelease(entry, locale, translationEnabled);
    return {
      id: entry.id,
      title: copy.title,
      summary: copy.summary,
      category: entry.category,
      categoryLabel:
        entry.category === "feature"
          ? t("widget.categoryFeature")
          : entry.category === "improvement"
            ? t("widget.categoryImprovement")
            : t("widget.categoryFix"),
      dateLabel: formatPublicDate(locale, entry.publishedAt),
      href: panelHref(shell, { view: "updates", slug: entry.slug }, query),
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          {t("widget.updatesTitle")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("updates.subtitle", { product: page.product.name })}
        </p>
      </div>
      {page.entries.length === 0 ? (
        <WidgetEmpty
          title={t("updates.emptyTitle")}
          body={t("updates.emptyBody")}
        />
      ) : (
        <WidgetWhatsNewView
          items={items}
          labels={{
            search: t("widget.searchUpdates"),
            noResults: t("widget.noSearchResults"),
            emptyTitle: t("updates.emptyTitle"),
            emptyBody: t("updates.emptyBody"),
          }}
        />
      )}
    </div>
  );
}

export function WidgetUpdatePanel({
  shell,
  page,
  t,
  locale,
  translationEnabled,
  query,
}: {
  shell: WidgetShell;
  page: PublicChangelogDetailPage;
  t: Translate;
  locale: PublicLocaleCode;
  translationEnabled: boolean;
  query: WidgetQuery;
}) {
  const { entry } = page;
  const copy = translatedRelease(entry, locale, translationEnabled);

  return (
    <article className="space-y-3">
      <Link
        href={panelHref(shell, { view: "updates", slug: null }, query)}
        className="inline-flex min-h-6 items-center gap-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("updates.back")}
      </Link>

      <ReleaseCover
        cover={entry.cover}
        accentColor="#4f46e5"
        productInitial={copy.title.charAt(0)}
        className="h-28 w-full"
      />

      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ReleaseCategoryBadge category={entry.category} />
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarDays className="size-3" aria-hidden="true" />
            {formatPublicDate(locale, entry.publishedAt)}
          </span>
        </div>
        <h1 className="mt-1.5 break-words text-lg font-semibold leading-snug">
          {copy.title}
        </h1>
        {copy.summary ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {copy.summary}
          </p>
        ) : null}
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <UserRound className="size-3" aria-hidden="true" />
          {entry.authors.length > 0
            ? t("updates.byline", {
                authors: entry.authors.map((author) => author.name).join(", "),
              })
            : t("common.team")}
        </p>
      </div>

      {entry.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <li key={tag}>
              <TagChip name={tag} color={null} />
            </li>
          ))}
        </ul>
      ) : null}

      {entry.youtubeUrl ? (
        <YouTubeEmbed url={entry.youtubeUrl} title={copy.title} />
      ) : null}

      <Markdown>{copy.body}</Markdown>

      {entry.linkedRequests.length > 0 ? (
        <section className="rounded-lg border bg-muted/20 p-3">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold">
            <Tag className="size-3.5" aria-hidden="true" />
            {t("updates.builtFrom")}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("updates.builtFromBody")}
          </p>
          <ul className="mt-2 space-y-1.5">
            {entry.linkedRequests.map((request) => (
              <li key={request.id}>
                <Link
                  href={panelHref(
                    shell,
                    {
                      view: "feedback",
                      boardSlug: request.boardSlug,
                      requestId: request.id,
                    },
                    query,
                  )}
                  className="flex items-start justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs hover:border-primary/30 hover:text-primary"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {request.title}
                  </span>
                  <ArrowUpRight
                    className="size-3 shrink-0 opacity-50"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

export function WidgetNotificationsPanel({
  shell,
  inbox,
  t,
  locale,
  query,
}: {
  shell: WidgetShell;
  inbox: PublicInbox;
  t: Translate;
  locale: PublicLocaleCode;
  query: WidgetQuery;
}) {
  if (inbox.state === "not_found") {
    return (
      <WidgetEmpty
        title={t("notifications.emptyTitle")}
        body={t("notifications.emptyBody")}
      />
    );
  }

  if (inbox.state === "signed_out") {
    const loginHref = `${publicLoginPath(
      inbox.workspace.slug,
      inbox.product.slug,
    )}?next=${encodeURIComponent(
      widgetEmbedHref(
        inbox.workspace.slug,
        inbox.product.slug,
        { view: "notifications" },
        query,
      ),
    )}`;

    return (
      <WidgetEmpty
        title={t("notifications.signInTitle")}
        body={t("notifications.signInBody")}
        action={
          <Button asChild size="sm" variant="outline">
            <a href={loginHref} target="_blank" rel="noreferrer">
              {t("common.signIn")}
            </a>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            {t("notifications.title")}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("notifications.subtitle", { product: inbox.product.name })}
          </p>
        </div>
        {inbox.unread > 0 ? (
          <MarkAllReadButton
            workspaceSlug={inbox.workspace.slug}
            productSlug={inbox.product.slug}
            unread={inbox.unread}
          />
        ) : null}
      </div>

      {inbox.items.length === 0 ? (
        <WidgetEmpty
          title={t("notifications.emptyTitle")}
          body={t("notifications.emptyBody")}
        />
      ) : (
        <ul className="space-y-2" aria-label={t("notifications.listLabel")}>
          {inbox.items.map((item) => {
            const route =
              widgetRouteFromPublicPath(
                inbox.workspace.slug,
                inbox.product.slug,
                item.href,
              ) ?? null;
            const href = route
              ? panelHref(shell, route, query)
              : item.href;
            // A reply notification carries `#comment-<id>`. The widget
            // request panel has no comment scroller, so open that one on the
            // public page, which highlights the exact comment.
            const deepLink = hasCommentAnchor(item.href);
            const className =
              "block rounded-md border bg-card p-2.5 transition-colors hover:bg-muted/60";
            const body = (
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                    item.read ? "bg-transparent" : "bg-primary"
                  }`}
                />
                <div className="min-w-0">
                  <p className="break-words text-xs font-medium">
                    {item.read ? null : (
                      <span className="sr-only">
                        {t("notifications.unreadLabel")}{" "}
                      </span>
                    )}
                    {item.title}
                  </p>
                  <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {t("notifications.received", {
                      date: formatPublicDate(locale, item.createdAt),
                    })}
                  </p>
                </div>
              </div>
            );

            return (
              <li key={item.id}>
                {deepLink ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                  >
                    {body}
                  </a>
                ) : (
                  <Link href={href} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function WidgetWhatsNewPanel({
  shell,
  page,
  accentColor,
  accentForeground = "#ffffff",
  logoUrl = null,
  t,
  locale,
  translationEnabled,
  sections,
  query,
}: {
  shell: WidgetShell;
  page: PublicChangelogPage | null;
  accentColor: string;
  accentForeground?: string;
  logoUrl?: string | null;
  t: Translate;
  locale: PublicLocaleCode;
  translationEnabled: boolean;
  sections: WidgetSection[];
  query: WidgetQuery;
}) {
  const updatesHref = panelHref(
    shell,
    { view: "updates", slug: null },
    query,
  );
  const messagesHref =
    sections.includes("messages") && shell.panels.messages
      ? panelHref(shell, { view: "messages" }, query)
      : null;
  const helpHref =
    sections.includes("help") && shell.panels.help
      ? panelHref(shell, { view: "help" }, query)
      : null;
  const composeHref =
    sections.includes("feedback") &&
    shell.panels.feedback &&
    shell.boardSlug !== null
      ? panelHref(
          shell,
          {
            view: "feedback",
            boardSlug: shell.boardSlug,
            compose: true,
          },
          query,
        )
      : null;
  const roadmapHref =
    sections.includes("roadmap") && shell.panels.roadmap
      ? panelHref(shell, { view: "roadmap" }, query)
      : null;

  const latest = page?.entries[0] ?? null;
  const latestCopy = latest
    ? translatedRelease(latest, locale, translationEnabled)
    : null;
  const moreUpdates = (page?.entries ?? []).slice(1, 3).map((entry) => {
    const copy = translatedRelease(entry, locale, translationEnabled);
    return {
      id: entry.id,
      href: panelHref(shell, { view: "updates", slug: entry.slug }, query),
      title: copy.title,
    };
  });

  const actions: WidgetHomeAction[] = [];
  if (helpHref) {
    actions.push({
      href: helpHref,
      label: t("widget.searchHelp"),
      icon: "help",
    });
  }
  if (composeHref) {
    actions.push({
      href: composeHref,
      label: t("widget.submitRequest"),
      icon: "request",
    });
  }
  if (roadmapHref) {
    actions.push({
      href: roadmapHref,
      label: t("roadmap.nav"),
      icon: "roadmap",
    });
  }

  return (
    <WidgetHomeView
      productInitial={shell.product.name.trim().charAt(0).toUpperCase() || "H"}
      logoUrl={logoUrl}
      accentColor={accentColor}
      accentForeground={accentForeground}
      greeting={t("widget.greeting")}
      title={t("widget.homeTitle", { product: shell.product.name })}
      message={
        messagesHref
          ? {
              href: messagesHref,
              title: t("widget.sendMessage"),
              body: t("widget.sendMessageBody"),
              placeholder: t("widget.writeMessage"),
            }
          : null
      }
      actions={actions}
      latestUpdate={
        latest && latestCopy
          ? {
              id: latest.id,
              href: panelHref(
                shell,
                { view: "updates", slug: latest.slug },
                query,
              ),
              title: latestCopy.title,
              summary: latestCopy.summary,
              category: latest.category,
              cover: latest.cover,
              dateLabel: formatPublicDate(locale, latest.publishedAt),
            }
          : null
      }
      moreUpdates={moreUpdates}
      updatesHref={updatesHref}
      labels={{
        latestUpdate: t("widget.latestUpdate"),
        viewAllUpdates: t("widget.viewAllUpdates"),
        emptyTitle: t("widget.noPublishedTitle"),
        emptyBody: t("widget.noPublishedBody"),
      }}
      updatesEnabled={shell.panels.updates}
    />
  );
}

export async function WidgetMessagesPanel({
  shell,
  hostOrigin,
}: {
  shell: WidgetShell;
  query: WidgetQuery;
  hostOrigin: string | null;
}) {
  const initial = await loadCustomerThreads({
    workspaceSlug: shell.workspace.slug,
    productSlug: shell.product.slug,
  });

  return (
    <WidgetMessagesView
      workspaceSlug={shell.workspace.slug}
      productSlug={shell.product.slug}
      productName={shell.product.name}
      hostOrigin={hostOrigin}
      initial={initial}
    />
  );
}
