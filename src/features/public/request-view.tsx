import { ArrowLeft, ArrowUpRight, MessageSquare, Paperclip } from "lucide-react";
import Link from "next/link";

import { TagChip } from "@/components/shared/feedback-primitives";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

import { CommentForm } from "./comment-form";
import { formatBytes, formatPlannedFor } from "./format";
import { formatPublicDate } from "./i18n";
import { getPublicSite } from "./i18n/server";
import { IdentifyForm } from "./identify-form";
import {
  publicBoardPath,
  publicChangelogEntryPath,
  publicRequestPath,
  publicSubmitPath,
} from "./paths";
import {
  PUBLIC_CATEGORY_LABELS,
  PUBLIC_STATUS_LABELS,
  PUBLIC_STATUS_TONES,
} from "./presentation";
import { PublicHeader } from "./public-header";
import { FollowButton, ReactionBar, VoteButton } from "./request-actions";
import { ShareLinks } from "./share-links";
import type { PublicRequestPage } from "./types";
import type { PublicViewerIdentity } from "./viewer";

/**
 * Request detail presentation.
 *
 * Everything here comes from the public projection: no dashboard snapshot, no
 * customer email, no moderation reason. Controls are client islands that call
 * the public endpoints; the page itself stays server-rendered so a shared link
 * shows the right content without JavaScript.
 */

function apiBase(page: PublicRequestPage): string {
  return `/api/public/boards/${encodeURIComponent(
    page.workspace.slug,
  )}/${encodeURIComponent(page.product.slug)}/${encodeURIComponent(
    page.board.slug,
  )}/requests/${encodeURIComponent(page.request.id)}`;
}

export async function PublicRequestView({
  page,
  path,
  submitted,
  viewer,
}: {
  page: PublicRequestPage;
  path: string;
  submitted: "published" | "awaiting_review" | null;
  viewer: PublicViewerIdentity | null;
}) {
  const site = await getPublicSite(page.workspace.slug);
  const { t, tc, locale } = site;
  const { request, board } = page;
  const boardPath = publicBoardPath(
    page.workspace.slug,
    page.product.slug,
    page.board.slug,
  );
  const requestApiBase = apiBase(page);
  const publicCommentCount = request.comments.filter(
    (comment) => !comment.pending,
  ).length;
  const needsIdentity = !board.guestPosting && !request.viewer.identified;
  const demandKey =
    request.demand.customers === 1
      ? request.demand.sources === 1
        ? ("request.demand.one.one" as const)
        : ("request.demand.one.other" as const)
      : request.demand.sources === 1
        ? ("request.demand.other.one" as const)
        : ("request.demand.other.other" as const);

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        productName={page.product.name}
        workspaceSlug={page.workspace.slug}
        productSlug={page.product.slug}
        viewer={viewer}
        homeHref={boardPath}
        nextPath={path}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={boardPath}
            className="inline-flex min-h-6 items-center gap-1.5 py-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            {board.name}
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link
              href={publicSubmitPath(
                page.workspace.slug,
                page.product.slug,
                page.board.slug,
              )}
            >
              {t("request.newRequest")}
            </Link>
          </Button>
        </div>

        {submitted === "published" ? (
          <div
            role="status"
            className="mt-4 rounded-lg border border-success/30 bg-success-muted px-4 py-3 text-sm text-success"
          >
            {t("request.liveReceipt")}
          </div>
        ) : null}

        {request.visibility === "awaiting_review" ? (
          <div
            role="status"
            className="mt-4 rounded-lg border border-warning/30 bg-warning-muted px-4 py-3 text-sm text-warning"
          >
            <p className="font-medium">{t("request.awaitingTitle")}</p>
            <p className="mt-1">{t("request.awaitingBody")}</p>
          </div>
        ) : null}

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={PUBLIC_STATUS_TONES[request.status]} className="rounded-full text-[11px]">
                {t(PUBLIC_STATUS_LABELS[request.status])}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                {t(PUBLIC_CATEGORY_LABELS[request.category])}
              </span>
              {request.privacy !== "public" ? (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(
                    request.privacy === "company"
                      ? "privacy.badge.company"
                      : "privacy.badge.author",
                  )}
                </span>
              ) : null}
            </div>

            <h1 className="mt-2 break-words text-2xl font-semibold leading-snug tracking-tight text-foreground">
              {request.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {request.authorName} ·{" "}
              <time dateTime={request.createdAt}>
                {formatPublicDate(locale, request.createdAt)}
              </time>
            </p>
            {request.demand.sources > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t(demandKey, {
                  customers: request.demand.customers,
                  sources: request.demand.sources,
                })}
              </p>
            ) : null}
            {request.plannedFor ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("request.plannedFor", {
                  value: formatPlannedFor(locale, request.plannedFor),
                })}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <VoteButton
                requestApiBase={requestApiBase}
                initialVoted={request.viewer.hasVoted}
                initialCount={request.voteCount}
              />
              <FollowButton
                requestApiBase={requestApiBase}
                initialFollows={request.viewer.follows}
              />
            </div>

            <div className="mt-6 whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
              {request.body}
            </div>

            {request.attachments.length > 0 ? (
              <div className="mt-6 space-y-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("request.attachments")}
                </h2>
                <ul className="space-y-2">
                  {request.attachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="rounded-md border bg-card p-3"
                    >
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
                            className="max-h-80 w-auto rounded border"
                          />
                        </a>
                      ) : null}
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex min-h-6 max-w-full items-center gap-1.5 break-all py-0.5 text-sm text-primary hover:underline"
                      >
                        <Paperclip className="size-4" aria-hidden="true" />
                        {attachment.fileName}
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(attachment.byteSize)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <section aria-label={t("request.reactions")} className="mt-6">
              <ReactionBar
                requestApiBase={requestApiBase}
                initial={request.reactions}
              />
            </section>

            <section aria-labelledby="discussion-heading" className="mt-8">
              <h2
                id="discussion-heading"
                className="flex items-center gap-2 text-base font-semibold text-foreground"
              >
                <MessageSquare className="size-4" aria-hidden="true" />
                {t("request.discussion")}
                <span className="text-sm font-normal text-muted-foreground">
                  {publicCommentCount}
                </span>
              </h2>

              {request.comments.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("request.noComments")}
                </p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {request.comments.map((comment) => (
                    <li
                      key={comment.id}
                      id={`comment-${comment.id}`}
                      className={`scroll-mt-24 rounded-lg border p-4 target:ring-2 target:ring-ring/50 ${
                        comment.pending
                          ? "border-warning/30 bg-warning-muted/40"
                          : "bg-card"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {comment.authorName}
                        </span>
                        {comment.authorType === "team" ? (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            {t("common.team")}
                          </span>
                        ) : null}
                        <span aria-hidden="true">·</span>
                        <time dateTime={comment.createdAt}>
                          {formatPublicDate(locale, comment.createdAt)}
                        </time>
                        {comment.pending ? (
                          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                            {t("common.awaitingReview")}
                          </span>
                        ) : null}
                        {comment.privacy !== "public" ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {t(
                              comment.privacy === "company"
                                ? "privacy.badge.company"
                                : "privacy.badge.author",
                            )}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground">
                        {comment.body}
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              {!board.acceptsComments ? (
                <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {t("request.commentsClosed")}
                </p>
              ) : needsIdentity ? (
                <div className="mt-4">
                  <IdentifyForm workspaceSlug={page.workspace.slug} />
                </div>
              ) : (
                <CommentForm
                  requestApiBase={requestApiBase}
                  hasCompany={request.viewer.hasCompany}
                />
              )}
            </section>
          </article>

          <aside className="space-y-6">
            {request.tags.length > 0 ? (
              <section aria-labelledby="tags-heading">
                <h2
                  id="tags-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("request.tags")}
                </h2>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {request.tags.map((tag) => (
                    <li key={tag.name}>
                      <TagChip name={tag.name} color={tag.color} className="bg-card" />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {request.linkedReleases.length > 0 ? (
              <section aria-labelledby="updates-heading">
                <h2
                  id="updates-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("request.linkedUpdates")}
                </h2>
                <ul className="mt-2 space-y-2">
                  {request.linkedReleases.map((release) => (
                    <li key={release.id} className="text-sm">
                      <Link
                        href={publicChangelogEntryPath(
                          page.workspace.slug,
                          page.product.slug,
                          release.slug,
                        )}
                        className="inline-flex min-h-6 items-center py-0.5 font-medium text-foreground hover:text-primary"
                      >
                        {release.title}
                      </Link>
                      {release.publishedAt ? (
                        <p className="text-xs text-muted-foreground">
                          {t("request.shippedOn", {
                            date: formatPublicDate(locale, release.publishedAt),
                          })}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {request.mergedRequests.length > 0 ? (
              <section aria-labelledby="merged-heading">
                <h2
                  id="merged-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("request.mergedRequests")}
                </h2>
                <ul className="mt-2 space-y-2">
                  {request.mergedRequests.map((merged) => (
                    <li key={merged.id}>
                      <Link
                        href={publicRequestPath(
                          page.workspace.slug,
                          page.product.slug,
                          merged.boardSlug,
                          merged.id,
                        )}
                        className="group flex min-h-6 items-start gap-1 py-0.5 text-sm text-foreground hover:text-primary"
                      >
                        <span className="flex-1">{merged.title}</span>
                        <ArrowUpRight
                          className="mt-0.5 size-3.5 shrink-0 opacity-50 group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {tc("common.voteCount.one", "common.voteCount.other", merged.voteCount)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {request.similarRequests.length > 0 ? (
              <section aria-labelledby="similar-heading">
                <h2
                  id="similar-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("request.similarRequests")}
                </h2>
                <ul className="mt-2 space-y-2">
                  {request.similarRequests.map((similar) => (
                    <li key={similar.id}>
                      <Link
                        href={publicRequestPath(
                          page.workspace.slug,
                          page.product.slug,
                          similar.boardSlug,
                          similar.id,
                        )}
                        className="inline-flex min-h-6 items-center py-0.5 text-sm text-foreground hover:text-primary"
                      >
                        {similar.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {tc("common.voteCount.one", "common.voteCount.other", similar.voteCount)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="share-heading">
              <h2
                id="share-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("request.share")}
              </h2>
              <div className="mt-2">
                <ShareLinks path={path} title={request.title} />
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
