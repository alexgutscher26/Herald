"use client";

import {
  ExternalLink,
  GripVertical,
  Map as MapIcon,
  Target,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type DragEvent } from "react";
import { toast } from "sonner";

import { VoteCountBox } from "@/components/shared/feedback-primitives";
import { PrioritisationSignals } from "@/components/shared/prioritisation-signals";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { FEEDBACK_STATUS_LABELS } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAnnounce } from "@/features/accessibility/live-announcer";
import { updateFeedbackStatusAction } from "@/features/feedback/actions";
import {
  comparePostsBySignal,
  TOP_UNMET_MIN_SCORE,
  topUnmetDemand,
  type PrioritisationSort,
} from "@/features/feedback/prioritisation";
import {
  getFeedbackForProduct,
  getPrioritySignals,
  getRouteContext,
  getVoteCount,
} from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { FeedbackPost, FeedbackStatus, PrioritySignals } from "@/types";

import { updatePublicSurfacesAction } from "./actions";
import { getRoadmapPrompt, type RoadmapPrompt } from "./prompts";
import {
  RoadmapManager,
  type RoadmapAdminItem,
  type RoadmapBoardOption,
} from "./roadmap-manager";

const COLUMNS: { status: FeedbackStatus; hint: string }[] = [
  { status: "new", hint: "Newly captured, not triaged yet." },
  { status: "under_review", hint: "Being evaluated by the team." },
  { status: "planned", hint: "Committed and published as Planned." },
  { status: "in_progress", hint: "Actively being built." },
  { status: "shipped", hint: "Released and published as Done." },
  { status: "closed", hint: "Not pursuing, or already merged." },
];

function RoadmapCard({
  post,
  votes,
  signals,
  canWrite,
  dragging,
  prompt,
  feedbackHref,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  post: FeedbackPost;
  votes: number;
  signals: PrioritySignals;
  canWrite: boolean;
  dragging: boolean;
  prompt: RoadmapPrompt | null;
  feedbackHref: string;
  onDragStart: (event: DragEvent<HTMLElement>, post: FeedbackPost) => void;
  onDragEnd: () => void;
  onMove: (post: FeedbackPost, status: FeedbackStatus) => void;
}) {
  return (
    <article
      draggable={canWrite}
      onDragStart={(event) => onDragStart(event, post)}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm",
        canWrite && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        {canWrite ? (
          <GripVertical
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`?post=${post.id}`}
              className="break-words text-sm font-medium leading-snug hover:text-primary"
            >
              {post.title}
            </Link>
            <VoteCountBox count={votes} className="border-0 bg-transparent" />
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {post.authorName} · {FEEDBACK_STATUS_LABELS[post.status]}
            {post.hiddenAt ? " · hidden from public" : ""}
          </p>
          <PrioritisationSignals signals={signals} className="mt-1.5" />
        </div>
      </div>

      <div className="mt-2">
        <label htmlFor={`roadmap-status-${post.id}`} className="sr-only">
          Move {post.title} to another status
        </label>
        <select
          id={`roadmap-status-${post.id}`}
          value={post.status}
          aria-describedby="roadmap-instructions"
          disabled={!canWrite || Boolean(post.mergedIntoId)}
          onChange={(event) => onMove(post, event.target.value as FeedbackStatus)}
          className="w-full rounded-md border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {COLUMNS.map((column) => (
            <option key={column.status} value={column.status}>
              {FEEDBACK_STATUS_LABELS[column.status]}
            </option>
          ))}
        </select>
      </div>

      {prompt ? (
        <Link
          href={feedbackHref}
          className="mt-2 block rounded-md border border-warning/30 bg-warning-muted/40 p-2 text-[11px] leading-relaxed transition-colors hover:bg-warning-muted/70"
        >
          <span className="font-semibold text-warning">{prompt.label}</span>
          <span className="block text-foreground">{prompt.message}</span>
          <span className="mt-0.5 block text-muted-foreground">
            {prompt.suggestedAction}
          </span>
        </Link>
      ) : null}
    </article>
  );
}

export function RoadmapView({
  workspaceSlug,
  productSlug,
  publicFeedbackEnabled,
  publicRoadmapEnabled,
  publicChangelogEnabled,
  publicShippedCounterEnabled,
  canManage,
  publicBoardSlug,
  boards,
  roadmaps,
}: {
  workspaceSlug: string;
  productSlug: string;
  publicFeedbackEnabled: boolean;
  publicRoadmapEnabled: boolean;
  publicChangelogEnabled: boolean;
  publicShippedCounterEnabled: boolean;
  canManage: boolean;
  publicBoardSlug: string | null;
  boards: RoadmapBoardOption[];
  roadmaps: RoadmapAdminItem[];
}) {
  const router = useRouter();
  const { state } = useDashboard();
  const announce = useAnnounce();
  const context = getRouteContext(state, workspaceSlug, productSlug);
  const [feedbackEnabled, setFeedbackEnabled] = useState(publicFeedbackEnabled);
  const [roadmapEnabled, setRoadmapEnabled] = useState(publicRoadmapEnabled);
  const [changelogEnabled, setChangelogEnabled] = useState(publicChangelogEnabled);
  const [shippedCounterEnabled, setShippedCounterEnabled] = useState(
    publicShippedCounterEnabled,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<FeedbackStatus | null>(null);
  const [signalSort, setSignalSort] = useState<PrioritisationSort | "none">("none");
  const [, startVisibility] = useTransition();

  if (!context) {
    return (
      <EmptyState
        title="Product not found"
        description="This workspace or product is not available to your account."
      />
    );
  }

  const canWrite = hasPermission(context.role, "feedback:write");
  const posts = getFeedbackForProduct(state, context.product.id).filter(
    (post) => post.mergedIntoId === null,
  );
  const promptNow = new Date(state.liveNow);
  const promptEntries = posts.flatMap((post) => {
    const prompt = getRoadmapPrompt(
      {
        status: post.status,
        updatedAt: post.updatedAt,
        votes: getVoteCount(state, post.id),
      },
      promptNow,
    );
    return prompt ? [{ post, prompt }] : [];
  });
  const promptById = new Map(promptEntries.map(({ post, prompt }) => [post.id, prompt]));
  const unmetDemand = topUnmetDemand(
    posts.map((post) => ({ post, signals: getPrioritySignals(state, post.id) })),
  );
  const feedbackHref = (postId: string) =>
    `/app/${workspaceSlug}/${productSlug}/feedback?post=${postId}`;

  const sortRequests = (requests: FeedbackPost[]) => {
    if (signalSort === "none") return requests;
    return [...requests].sort((a, b) =>
      comparePostsBySignal(
        a,
        b,
        (postId) => getPrioritySignals(state, postId),
        (postId) => getVoteCount(state, postId),
        signalSort,
      ),
    );
  };

  function saveVisibility(
    nextFeedback: boolean,
    nextRoadmap: boolean,
    nextChangelog: boolean,
    nextShippedCounter: boolean,
  ) {
    const previousFeedback = feedbackEnabled;
    const previousRoadmap = roadmapEnabled;
    const previousChangelog = changelogEnabled;
    const previousShippedCounter = shippedCounterEnabled;
    setFeedbackEnabled(nextFeedback);
    setRoadmapEnabled(nextRoadmap);
    setChangelogEnabled(nextChangelog);
    setShippedCounterEnabled(nextShippedCounter);

    startVisibility(async () => {
      const result = await updatePublicSurfacesAction({
        workspaceSlug,
        productSlug,
        publicFeedbackEnabled: nextFeedback,
        publicRoadmapEnabled: nextRoadmap,
        publicChangelogEnabled: nextChangelog,
        publicShippedCounterEnabled: nextShippedCounter,
      });
      if (!result.ok) {
        setFeedbackEnabled(previousFeedback);
        setRoadmapEnabled(previousRoadmap);
        setChangelogEnabled(previousChangelog);
        setShippedCounterEnabled(previousShippedCounter);
        toast.error("Could not change public visibility", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function move(post: FeedbackPost, status: FeedbackStatus) {
    if (status === post.status || !canWrite) return;
    void updateFeedbackStatusAction({
      workspaceSlug,
      productSlug,
      postId: post.id,
      status,
    }).then((result) => {
      if (!result.ok) {
        announce(`Could not move ${post.title}: ${result.error}`, "assertive");
        toast.error("Could not move that request", { description: result.error });
        return;
      }
      const label = `Moved ${post.title} to ${FEEDBACK_STATUS_LABELS[status]}`;
      announce(label);
      router.refresh();
    });
  }

  function handleDragStart(event: DragEvent<HTMLElement>, post: FeedbackPost) {
    setDraggingId(post.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", post.id);
  }

  function handleDrop(event: DragEvent<HTMLElement>, status: FeedbackStatus) {
    event.preventDefault();
    const postId = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setOverStatus(null);
    const post = posts.find((candidate) => candidate.id === postId);
    if (post) move(post, status);
  }

  const roadmapPath = `/p/${workspaceSlug}/${productSlug}/roadmap`;
  const changelogPath = `/p/${workspaceSlug}/${productSlug}/updates`;
  const boardPath = publicBoardSlug
    ? `/p/${workspaceSlug}/${productSlug}/${publicBoardSlug}`
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roadmap"
        description="Requests are the roadmap. Drag a card to change its status; the public Planned, In progress and Done columns read the same row."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="roadmap-sort" className="sr-only">
              Sort roadmap cards
            </label>
            <select
              id="roadmap-sort"
              value={signalSort}
              onChange={(event) =>
                setSignalSort(event.target.value as PrioritisationSort | "none")
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="none">Newest first</option>
              <option value="priority">Priority score</option>
              <option value="impact">Impact</option>
              <option value="value_effort">Value ÷ effort</option>
              <option value="requester_weight">Requester weight</option>
              <option value="revenue">Known ARR</option>
            </select>
            {roadmapEnabled ? (
              <Button asChild variant="outline" size="sm">
                <Link href={roadmapPath} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  View public roadmap
                </Link>
              </Button>
            ) : null}
          </div>
        }
        meta={
          <>
            <span>{posts.length} requests</span>
            <span aria-hidden="true">·</span>
            <span>Status is the only source</span>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MapIcon className="size-4" aria-hidden="true" />
              Public surfaces
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Feedback and the roadmap are independent. Turning feedback off hides the boards;
              the roadmap can still show Planned, In progress and Done.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="public-feedback" className="text-sm font-medium">
                Public feedback
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Public boards, request pages, voting and commenting.
              </p>
            </div>
            <Switch
              id="public-feedback"
              checked={feedbackEnabled}
              onCheckedChange={(checked) =>
                saveVisibility(
                  checked,
                  roadmapEnabled,
                  changelogEnabled,
                  shippedCounterEnabled,
                )
              }
              disabled={!canManage}
            />
          </div>

          <div className="flex items-start justify-between gap-4 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="public-roadmap" className="text-sm font-medium">
                Public roadmap
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Planned, In progress and Done, with vote counts. Only approved requests on
                public boards appear.
              </p>
            </div>
            <Switch
              id="public-roadmap"
              checked={roadmapEnabled}
              onCheckedChange={(checked) =>
                saveVisibility(
                  feedbackEnabled,
                  checked,
                  changelogEnabled,
                  shippedCounterEnabled,
                )
              }
              disabled={!canManage}
            />
          </div>

          <div className="flex items-start justify-between gap-4 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="public-changelog" className="text-sm font-medium">
                Public changelog
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Published releases with the public-changelog channel. Independent of feedback and
                the roadmap.
              </p>
            </div>
            <Switch
              id="public-changelog"
              checked={changelogEnabled}
              onCheckedChange={(checked) =>
                saveVisibility(
                  feedbackEnabled,
                  roadmapEnabled,
                  checked,
                  shippedCounterEnabled,
                )
              }
              disabled={!canManage}
            />
          </div>

          <div className="flex items-start justify-between gap-4 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="public-shipped-counter" className="text-sm font-medium">
                Shipped this quarter
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Shows the number of requests moved to Shipped this quarter on the portal home.
                Off by default.
              </p>
            </div>
            <Switch
              id="public-shipped-counter"
              checked={shippedCounterEnabled}
              onCheckedChange={(checked) =>
                saveVisibility(
                  feedbackEnabled,
                  roadmapEnabled,
                  changelogEnabled,
                  checked,
                )
              }
              disabled={!canManage}
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            {roadmapEnabled ? (
              <Button asChild variant="outline" size="sm">
                <Link href={roadmapPath} target="_blank" rel="noreferrer">
                  View roadmap
                </Link>
              </Button>
            ) : null}
            {changelogEnabled ? (
              <Button asChild variant="outline" size="sm">
                <Link href={changelogPath} target="_blank" rel="noreferrer">
                  View changelog
                </Link>
              </Button>
            ) : null}
            {feedbackEnabled && boardPath ? (
              <Button asChild variant="outline" size="sm">
                <Link href={boardPath} target="_blank" rel="noreferrer">
                  View feedback
                </Link>
              </Button>
            ) : null}
            {feedbackEnabled && !boardPath ? (
              <p className="text-xs text-muted-foreground">
                Create a public board under Boards to publish feedback.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <RoadmapManager
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        boards={boards}
        roadmaps={roadmaps}
        canManage={canManage}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <Target className="size-4 text-primary" aria-hidden="true" />
            Top unmet demand
            <Badge variant="secondary">{unmetDemand.length}</Badge>
          </CardTitle>
          <CardDescription>
            Score {TOP_UNMET_MIN_SCORE} or higher with no release linked, oldest first. This is
            an internal report; neither the score nor the ordering is published.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unmetDemand.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No scored request is both high priority and unlinked from a release.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {unmetDemand.map(({ post, signals }) => {
                const ageDays = Math.max(
                  0,
                  Math.floor(
                    (promptNow.getTime() - new Date(post.createdAt).getTime()) /
                      86_400_000,
                  ),
                );
                return (
                  <li
                    key={post.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{post.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Score {signals.priorityScore} · {signals.requesterCount} requester
                        {signals.requesterCount === 1 ? "" : "s"} ·{" "}
                        {ageDays === 0
                          ? "today"
                          : `${ageDays} day${ageDays === 1 ? "" : "s"} old`}{" "}
                        · {FEEDBACK_STATUS_LABELS[post.status]}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={feedbackHref(post.id)}>Open request</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p id="roadmap-instructions" className="text-xs text-muted-foreground">
        Drag a card between columns, or use the status menu on the card. Only unmerged requests
        appear. Hidden requests stay here for the team but never reach the public roadmap.
      </p>

      {promptEntries.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
              Needs attention
              <Badge variant="secondary">{promptEntries.length}</Badge>
            </CardTitle>
            <CardDescription>
              Stale commitments and low-traction reviews from the current snapshot. Nothing is
              moved or closed automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="divide-y rounded-md border">
              {promptEntries.slice(0, 6).map(({ post, prompt }) => (
                <li
                  key={post.id}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{post.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-warning">{prompt.label}</span> ·{" "}
                      {prompt.message} {prompt.suggestedAction}
                    </p>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={feedbackHref(post.id)}>Open request</Link>
                  </Button>
                </li>
              ))}
            </ul>
            {promptEntries.length > 6 ? (
              <p className="text-xs text-muted-foreground">
                {promptEntries.length - 6} more marked on the cards below.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title="No roadmap requests yet"
          description="Requests appear here as soon as feedback is collected. Move one to Planned to publish it."
        />
      ) : (
        <div className="overflow-x-auto pb-2" aria-describedby="roadmap-instructions">
          <div className="flex min-w-max gap-3">
            {COLUMNS.map((column) => {
              const requests = sortRequests(
                posts.filter((post) => post.status === column.status),
              );
              return (
                <section
                  key={column.status}
                  aria-label={`${FEEDBACK_STATUS_LABELS[column.status]} requests`}
                  onDragOver={(event) => {
                    if (!canWrite) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOverStatus(column.status);
                  }}
                  onDragLeave={() => setOverStatus((current) => (current === column.status ? null : current))}
                  onDrop={(event) => handleDrop(event, column.status)}
                  className={cn(
                    "w-72 shrink-0 rounded-lg border bg-muted/20 p-2 transition-colors",
                    overStatus === column.status && "border-primary/50 bg-primary/5",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                    <h2 className="text-sm font-semibold">
                      {FEEDBACK_STATUS_LABELS[column.status]}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {requests.length}
                    </span>
                  </div>
                  <p className="px-1 pb-2 text-[11px] leading-relaxed text-muted-foreground">
                    {column.hint}
                  </p>
                  <div className="space-y-2">
                    {requests.length === 0 ? (
                      <p className="rounded-md border border-dashed px-2 py-6 text-center text-xs text-muted-foreground">
                        No requests
                      </p>
                    ) : (
                      requests.map((post) => (
                        <RoadmapCard
                          key={post.id}
                          post={post}
                          votes={getVoteCount(state, post.id)}
                          signals={getPrioritySignals(state, post.id)}
                          canWrite={canWrite}
                          dragging={draggingId === post.id}
                          prompt={promptById.get(post.id) ?? null}
                          feedbackHref={feedbackHref(post.id)}
                          onDragStart={handleDragStart}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setOverStatus(null);
                          }}
                          onMove={move}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Only public boards contribute to the public roadmap. A hidden, merged, archived, rejected
        or banned-author request is excluded even if its column is public.
      </p>
    </div>
  );
}
