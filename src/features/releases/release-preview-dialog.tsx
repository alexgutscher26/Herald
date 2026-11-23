"use client";

import { CalendarDays, Globe2, Mail, Puzzle, UserRound } from "lucide-react";

import { Markdown } from "@/components/shared/markdown";
import { ReleaseCover } from "@/components/shared/release-cover";
import { TagChip } from "@/components/shared/feedback-primitives";
import { YouTubeEmbed } from "@/components/shared/youtube-embed";
import {
  ReleaseCategoryBadge,
  ReleaseStatusBadge,
} from "@/components/shared/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import type { Product, Release, Workspace } from "@/types";

type ReleasePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  release: Release;
  product: Product;
  workspace: Workspace;
};

export function ReleasePreviewDialog({
  open,
  onOpenChange,
  release,
  product,
  workspace,
}: ReleasePreviewDialogProps) {
  const timeZone = workspace.timezone;
  const date = release.publishedAt ?? release.scheduledFor;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview · {product.name} changelog</DialogTitle>
          <DialogDescription>
            How this entry appears on the public changelog. Distribution is not triggered by a
            preview.
          </DialogDescription>
        </DialogHeader>

        <article className="space-y-5">
          <ReleaseCover
            cover={release.cover}
            accentColor={product.accentColor}
            productInitial={product.name.charAt(0)}
            className="h-40 w-full sm:h-48"
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ReleaseCategoryBadge category={release.category} />
              <ReleaseStatusBadge status={release.status} />
              {date ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  {release.publishedAt ? "Published" : "Scheduled for"}{" "}
                  {formatDateTime(date, timeZone)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No publication date yet</span>
              )}
            </div>

            <h2 className="text-2xl font-semibold tracking-tight">{release.title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{release.summary}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="size-3.5" aria-hidden="true" />
              {release.authors.length > 0
                ? release.authors.map((author) => author.name).join(", ")
                : release.authorName}
            </p>
            {release.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {release.tags.map((tag) => (
                  <li key={tag}>
                    <TagChip name={tag} color={null} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <YouTubeEmbed url={release.youtubeUrl} title={release.title} />

          <Markdown>{release.body}</Markdown>

          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Distribution
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {release.channels.publicChangelog ? (
                <li className="flex items-center gap-1.5">
                  <Globe2 className="size-3.5" aria-hidden="true" /> Public changelog
                </li>
              ) : null}
              {release.channels.inAppWidget ? (
                <li className="flex items-center gap-1.5">
                  <Puzzle className="size-3.5" aria-hidden="true" /> In-app widget
                </li>
              ) : null}
              {release.channels.subscriberEmail ? (
                <li className="flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-hidden="true" /> Subscriber email (pending, no
                  provider)
                </li>
              ) : null}
              {!release.channels.publicChangelog &&
              !release.channels.inAppWidget &&
              !release.channels.subscriberEmail ? (
                <li className="text-muted-foreground">No channels selected</li>
              ) : null}
            </ul>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            This preview is rendered from the saved database record. The public changelog is live
            when the product&apos;s changelog visibility is enabled; the widget endpoint is not
            implemented yet.
          </p>
        </article>
      </DialogContent>
    </Dialog>
  );
}
