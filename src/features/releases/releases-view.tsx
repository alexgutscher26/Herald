"use client";

import { ViewerTimeZone } from "@/components/shared/dual-timestamp";
import { ColumnResizer, ColumnSettings } from "@/components/shared/column-settings";

import {
  Archive,
  ChevronDown,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { toastUndoable } from "@/components/shared/action-toast";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { ReleaseCover } from "@/components/shared/release-cover";
import { SearchInput } from "@/components/shared/search-input";
import {
  RELEASE_CATEGORY_LABELS,
  RELEASE_STATUS_LABELS,
  ReleaseCategoryBadge,
  ReleaseStatusBadge,
} from "@/components/shared/status-badge";
import { ResultCount, Toolbar, ToolbarGroup } from "@/components/shared/toolbar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getActiveSubscriberCount,
  getReleasesForProduct,
  getRouteContext,
} from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import {
  archiveReleaseAction,
  duplicateReleaseAction,
  publishReleaseAction,
  restoreReleaseAction,
} from "@/features/releases/actions";
import { formatDateTime, timeZoneAbbreviation } from "@/lib/format";
import { useColumnLayout, type ColumnDefinition } from "@/lib/list-preferences";
import type { Release, ReleaseCategory, ReleaseStatus } from "@/types";

import { AiDraftDialog } from "./ai-draft-dialog";
import { PublishReviewDialog } from "./publish-review-dialog";
import { snapshotFromRelease } from "./revision-types";
import { normalizeReleaseTags } from "./tags";
import { ReleasePreviewDialog } from "./release-preview-dialog";

const PAGE_SIZE = 6;
const RELEASE_COLUMNS: ColumnDefinition[] = [
  {
    id: "release",
    label: "Release",
    defaultWidth: 360,
    minWidth: 240,
    defaultVisible: true,
    required: true,
  },
  { id: "category", label: "Category", defaultWidth: 140, minWidth: 110, defaultVisible: true },
  { id: "status", label: "Status", defaultWidth: 120, minWidth: 100, defaultVisible: true },
  {
    id: "publication",
    label: "Publication",
    defaultWidth: 190,
    minWidth: 150,
    defaultVisible: true,
  },
  {
    id: "engagement",
    label: "Engagement",
    defaultWidth: 180,
    minWidth: 150,
    defaultVisible: true,
  },
];
const STATUS_OPTIONS: (ReleaseStatus | "all")[] = [
  "all",
  "draft",
  "scheduled",
  "published",
  "archived",
];
const CATEGORY_OPTIONS: (ReleaseCategory | "all")[] = [
  "all",
  "feature",
  "improvement",
  "fix",
];

export function ReleasesView({
  workspaceSlug,
  productSlug,
  initialStatus = "all",
}: {
  workspaceSlug: string;
  productSlug: string;
  initialStatus?: ReleaseStatus | "all";
}) {
  const router = useRouter();
  const { state } = useDashboard();
  const context = getRouteContext(state, workspaceSlug, productSlug);

  const [search, setSearch] = useState("");
  const columns = useColumnLayout(`${workspaceSlug}/${productSlug}/releases`, RELEASE_COLUMNS);
  const [status, setStatus] = useState<ReleaseStatus | "all">(initialStatus);
  const [category, setCategory] = useState<ReleaseCategory | "all">("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const releases = useMemo(
    () => (context ? getReleasesForProduct(state, context.product.id) : []),
    [state, context],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return releases.filter((release) => {
      if (status !== "all" && release.status !== status) return false;
      if (category !== "all" && release.category !== category) return false;
      if (!needle) return true;
      return [release.title, release.summary, release.slug, release.authorName]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [releases, search, status, category]);

  if (!context) {
    return (
      <EmptyState
        title="Product not found"
        description="This workspace or product is not available to your account."
      />
    );
  }

  const { workspace, product } = context;
  const base = `/app/${workspaceSlug}/${productSlug}`;
  const timeZone = workspace.timezone;
  const tz = timeZoneAbbreviation(timeZone);
  const previewRelease = releases.find((release) => release.id === previewId) ?? null;
  const publishReleaseTarget = releases.find((release) => release.id === publishId) ?? null;
  const archiveReleaseTarget = releases.find((release) => release.id === archiveId) ?? null;
  const visible = filtered.slice(0, visibleCount);
  const activeSubscribers = getActiveSubscriberCount(state, product.id);
  const filtersActive = search.trim().length > 0 || status !== "all" || category !== "all";

  async function handleDuplicate(release: Release) {
    const result = await duplicateReleaseAction({
      workspaceSlug,
      productSlug,
      releaseId: release.id,
    });
    if (!result.ok) {
      toast.error("Could not duplicate release", { description: result.error });
      return;
    }
    const copyId = result.data.releaseId;
    toast.success("Draft duplicated", {
      description: `"${release.title} (copy)" was created with no publication date.`,
      action: {
        label: "Open draft",
        onClick: () => router.push(`${base}/releases/${copyId}/edit`),
      },
    });
    router.refresh();
  }

  async function handlePublish() {
    if (!publishReleaseTarget) return;
    const result = await publishReleaseAction({
      workspaceSlug,
      productSlug,
      releaseId: publishReleaseTarget.id,
    });
    if (!result.ok) {
      toast.error("Could not publish release", { description: result.error });
      return;
    }
    toast.success("Release published", {
      description: publishReleaseTarget.channels.subscriberEmail
        ? "Pending email deliveries were recorded. No email or win-back campaign was sent."
        : "No win-back campaign was sent.",
    });
    setPublishId(null);
    router.refresh();
  }

  async function handleArchive() {
    if (!archiveReleaseTarget) return;
    const target = archiveReleaseTarget;
    const result = await archiveReleaseAction({
      workspaceSlug,
      productSlug,
      releaseId: target.id,
    });
    if (!result.ok) {
      toast.error("Could not archive release", { description: result.error });
      return;
    }
    toastUndoable({
      message: `"${target.title}" archived`,
      description: "It no longer appears on public or widget surfaces. Undo restores it.",
      onUndo: () => void handleRestore(target),
    });
    setArchiveId(null);
    router.refresh();
  }

  async function handleRestore(release: Release) {
    const result = await restoreReleaseAction({
      workspaceSlug,
      productSlug,
      releaseId: release.id,
    });
    if (!result.ok) {
      toast.error("Could not restore release", { description: result.error });
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Releases"
        description={`Draft, schedule and publish changelog entries for ${product.name}.`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAiOpen(true)}
            >
              <Sparkles aria-hidden="true" />
              Draft with AI
            </Button>
            <Button asChild size="sm">
              <Link href={`${base}/releases/new`}>
                <Plus aria-hidden="true" />
                New release
              </Link>
            </Button>
          </>
        }
        meta={
          <>
            <span>
              {releases.length} releases in this product
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Times shown in {tz} ({timeZone})
            </span>
            <span aria-hidden="true">·</span>
            <ViewerTimeZone timeZone={timeZone} />
            <span aria-hidden="true">·</span>
            <span>Publishing never sends win-back campaigns</span>
          </>
        }
      />

      <Toolbar>
        <ToolbarGroup>
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Search title, summary or slug…"
            label="Search releases"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as ReleaseStatus | "all");
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <SelectTrigger size="sm" className="w-36 bg-background" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All statuses" : RELEASE_STATUS_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value as ReleaseCategory | "all");
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <SelectTrigger size="sm" className="w-36 bg-background" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All categories" : RELEASE_CATEGORY_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setCategory("all");
                setVisibleCount(PAGE_SIZE);
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <ColumnSettings
            columns={RELEASE_COLUMNS}
            isVisible={columns.isVisible}
            onToggle={columns.setVisible}
            onReset={columns.reset}
          />
        </ToolbarGroup>
        <ResultCount shown={visible.length} total={filtered.length} noun="releases" />
      </Toolbar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title={filtersActive ? "No releases match these filters" : "No releases yet"}
          description={
            filtersActive
              ? "Adjust the search or filters to see more releases."
              : "Create your first changelog entry. You can save it as a draft and publish later."
          }
          action={
            filtersActive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setCategory("all");
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={`${base}/releases/new`}>
                  <Plus aria-hidden="true" />
                  Create release
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="table-fixed">
            <colgroup>
              <col style={{ width: columns.widthOf("release") }} />
              {columns.isVisible("category") ? (
                <col style={{ width: columns.widthOf("category") }} />
              ) : null}
              {columns.isVisible("status") ? (
                <col style={{ width: columns.widthOf("status") }} />
              ) : null}
              {columns.isVisible("publication") ? (
                <col style={{ width: columns.widthOf("publication") }} />
              ) : null}
              {columns.isVisible("engagement") ? (
                <col style={{ width: columns.widthOf("engagement") }} />
              ) : null}
              <col style={{ width: 48 }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="relative">
                  Release
                  <ColumnResizer
                    label="Release"
                    width={columns.widthOf("release")}
                    minWidth={240}
                    onChange={(width) => columns.setWidth("release", width)}
                  />
                </TableHead>
                {columns.isVisible("category") ? (
                  <TableHead className="relative">
                    Category
                    <ColumnResizer
                      label="Category"
                      width={columns.widthOf("category")}
                      minWidth={110}
                      onChange={(width) => columns.setWidth("category", width)}
                    />
                  </TableHead>
                ) : null}
                {columns.isVisible("status") ? (
                  <TableHead className="relative">
                    Status
                    <ColumnResizer
                      label="Status"
                      width={columns.widthOf("status")}
                      minWidth={100}
                      onChange={(width) => columns.setWidth("status", width)}
                    />
                  </TableHead>
                ) : null}
                {columns.isVisible("publication") ? (
                  <TableHead className="relative">
                    Publication
                    <ColumnResizer
                      label="Publication"
                      width={columns.widthOf("publication")}
                      minWidth={150}
                      onChange={(width) => columns.setWidth("publication", width)}
                    />
                  </TableHead>
                ) : null}
                {columns.isVisible("engagement") ? (
                  <TableHead className="relative">
                    Engagement
                    <ColumnResizer
                      label="Engagement"
                      width={columns.widthOf("engagement")}
                      minWidth={150}
                      onChange={(width) => columns.setWidth("engagement", width)}
                    />
                  </TableHead>
                ) : null}
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((release) => {
                const date = release.publishedAt ?? release.scheduledFor;
                return (
                  <TableRow key={release.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ReleaseCover
                          cover={release.cover}
                          accentColor={product.accentColor}
                          productInitial={product.name.charAt(0)}
                          className="h-10 w-16 shrink-0"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`${base}/releases/${release.id}/edit`}
                            className="block max-w-80 truncate text-sm font-medium hover:text-primary"
                          >
                            {release.title}
                          </Link>
                          <p className="mt-0.5 max-w-80 truncate text-xs text-muted-foreground">
                            {release.summary}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">/{release.slug}</p>
                        </div>
                      </div>
                    </TableCell>
                    {columns.isVisible("category") ? (
                      <TableCell>
                        <ReleaseCategoryBadge category={release.category} />
                      </TableCell>
                    ) : null}
                    {columns.isVisible("status") ? (
                      <TableCell>
                        <ReleaseStatusBadge status={release.status} />
                      </TableCell>
                    ) : null}
                    {columns.isVisible("publication") ? (
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {date ? (
                          <>
                            <span className="block">
                              {release.publishedAt ? "Published" : "Scheduled"}
                            </span>
                            <span>{formatDateTime(date, timeZone)}</span>
                          </>
                        ) : (
                          <span>Not scheduled</span>
                        )}
                      </TableCell>
                    ) : null}
                    {columns.isVisible("engagement") ? (
                      <TableCell className="text-xs">
                        {release.status !== "published" ? (
                          <span className="text-muted-foreground">Available after publishing</span>
                        ) : (
                          <span className="text-muted-foreground">Analytics not connected</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Actions for ${release.title}`}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>Release</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => setPreviewId(release.id)}>
                            <Eye aria-hidden="true" />
                            Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`${base}/releases/${release.id}/edit`}>
                              <Pencil aria-hidden="true" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void handleDuplicate(release)}>
                            <Copy aria-hidden="true" />
                            Duplicate
                          </DropdownMenuItem>
                          {(release.status === "draft" || release.status === "scheduled") ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => setPublishId(release.id)}>
                                <Rocket aria-hidden="true" />
                                Publish now
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          <DropdownMenuSeparator />
                          {release.status === "archived" ? (
                            <DropdownMenuItem onSelect={() => void handleRestore(release)}>
                              <RotateCcw aria-hidden="true" />
                              Restore
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setArchiveId(release.id)}
                            >
                              <Archive aria-hidden="true" />
                              Archive
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {visibleCount < filtered.length ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            <ChevronDown aria-hidden="true" />
            Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
          </Button>
        </div>
      ) : null}

      {previewRelease ? (
        <ReleasePreviewDialog
          open={previewId !== null}
          onOpenChange={(open) => !open && setPreviewId(null)}
          release={previewRelease}
          product={product}
          workspace={workspace}
        />
      ) : null}

      {publishReleaseTarget ? (
        <PublishReviewDialog
          open={publishId !== null}
          onOpenChange={(open) => !open && setPublishId(null)}
          title={publishReleaseTarget.title}
          summary={publishReleaseTarget.summary}
          cover={publishReleaseTarget.cover}
          channels={publishReleaseTarget.channels}
          scheduledFor={null}
          workspace={workspace}
          product={product}
          activeSubscriberCount={activeSubscribers}
          mode="publish"
          onConfirm={handlePublish}
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          releaseId={publishReleaseTarget.id}
          currentSnapshot={snapshotFromRelease(
            publishReleaseTarget,
            publishReleaseTarget.authors.map((author) => author.id),
          )}
          linkedFeedbackIds={publishReleaseTarget.linkedFeedbackIds}
          tagSlugs={normalizeReleaseTags(publishReleaseTarget.tags).map((tag) => tag.slug)}
          teamMembers={state.teamMembers}
          feedbackPosts={state.feedbackPosts}
          cancellationReasons={state.cancellationReasons}
        />
      ) : null}

      <AiDraftDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
      />

      <AlertDialog open={archiveId !== null} onOpenChange={(open) => !open && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this release?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveReleaseTarget
                ? `"${archiveReleaseTarget.title}" will be removed from public changelog and widget surfaces. You can restore it later.`
                : "This release will be archived."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive release</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
