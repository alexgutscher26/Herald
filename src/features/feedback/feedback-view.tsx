"use client";

import {
  ArrowBigUp,
  Ban,
  BookOpen,
  Clock,
  Eye,
  EyeOff,
  Keyboard,
  Link2,
  Lock,
  Merge,
  MessageSquare,
  MessagesSquare,
  Plus,
  RotateCcw,
  Save,
  Tag,
  Trash2,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CustomFieldInputs } from "@/components/shared/custom-field-inputs";
import { DualTimestamp } from "@/components/shared/dual-timestamp";
import { ListDensityToggle } from "@/components/shared/list-density-toggle";
import { TagChip, VoteCountBox } from "@/components/shared/feedback-primitives";
import {
  usePageShortcuts,
  useShortcuts,
  type KeyboardShortcut,
} from "@/components/shared/keyboard-shortcuts";
import { PrioritisationSignals } from "@/components/shared/prioritisation-signals";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FeedbackCategoryBadge,
  FeedbackStatusBadge,
} from "@/components/shared/status-badge";
import { ResultCount, Toolbar, ToolbarGroup } from "@/components/shared/toolbar";
import { useDensity } from "@/lib/list-preferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  addFeedbackCommentAction,
  bulkAssignFeedbackAction,
  bulkMoveFeedbackBoardAction,
  bulkSetFeedbackHiddenAction,
  bulkTagFeedbackAction,
  bulkUpdateFeedbackStatusAction,
  linkFeedbackToReleaseAction,
  mergeFeedbackAction,
  setFeedbackAssigneeAction,
  setPlannedForAction,
  setFeedbackHiddenAction,
  toggleFeedbackVoteAction,
  undoFeedbackBulkActionAction,
  unmergeFeedbackAction,
  updateFeedbackStatusAction,
} from "@/features/feedback/actions";
import { ATTENTION_OPTIONS, matchesAttention } from "@/features/feedback/attention";
import { plannedForLabel } from "@/features/feedback/planned-for";
import {
  setCustomFieldValuesAction,
  setPrioritisationAction,
} from "@/features/feedback/custom-field-actions";
import {
  compareCustomFieldValues,
  customFieldValueFor,
  matchesCustomFieldFilters,
} from "@/features/feedback/custom-fields";
import { CopyBriefButton } from "@/features/feedback/copy-brief-button";
import {
  addContextLinkAction,
  addInsightAction,
  deleteInsightAction,
  removeContextLinkAction,
} from "@/features/feedback/evidence-actions";
import {
  INSIGHT_SOURCE_LABELS,
  summarizeRequestDemand,
  type InsightSource,
} from "@/features/feedback/insight-rules";
import { OnBehalfDialog } from "@/features/feedback/on-behalf-dialog";
import { FeedbackIntegrationPanel } from "@/features/integrations/feedback-panel";
import { comparePostsBySignal, REVENUE_WEIGHT_UNIT } from "@/features/feedback/prioritisation";
import {
  deleteFeedbackViewAction,
  saveFeedbackViewAction,
} from "@/features/feedback/saved-view-actions";
import {
  createBoardTagAction,
  deleteBoardTagAction,
  setPostTagsAction,
} from "@/features/feedback/tag-actions";
import { setCustomerBanAction } from "@/features/moderation/actions";
import { requestMatchesSegment } from "@/features/public/segments";
import { rankSimilar } from "@/features/public/similarity";
import {
  getCommentsForPost,
  getCustomFieldsForProduct,
  getCustomFieldValuesForPost,
  getFeedbackById,
  getFeedbackForProduct,
  getPrioritisationForPost,
  getPrioritySignals,
  getReleasesForProduct,
  getRequesterSegmentsForPost,
  getRouteContext,
  getVoteCount,
  hasUserVoted,
} from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type {
  FeedbackAttentionFilter,
  FeedbackCategory,
  FeedbackCustomFieldSort,
  FeedbackPost,
  FeedbackSavedView,
  FeedbackSavedViewFilters,
  FeedbackStatus,
  FeedbackViewSort,
  SegmentFacetKind,
  SegmentFilter,
} from "@/types";

const PAGE_SIZE = 8;

const STATUS_OPTIONS: (FeedbackStatus | "all")[] = [
  "all",
  "new",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
];

const CATEGORY_OPTIONS: (FeedbackCategory | "all")[] = [
  "all",
  "feature_request",
  "bug",
  "improvement",
  "question",
];

const DEFAULT_FILTERS: FeedbackSavedViewFilters = {
  search: "",
  status: "all",
  category: "all",
  sort: "newest",
  customFieldSort: null,
  customFields: {},
  minScore: null,
  segment: null,
  assignee: "all",
  stale: "all",
};

const SORT_OPTIONS: { value: FeedbackViewSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
    { value: "votes", label: "Most votes" },
  { value: "priority", label: "Priority score" },
  { value: "impact", label: "Impact" },
  { value: "value_effort", label: "Value ÷ effort" },
  { value: "requester_weight", label: "Requester weight" },
  { value: "revenue", label: "Known ARR" },
];

const FIELD_FILTER_CLASS =
  "flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const SCORE_FILTER_OPTIONS = [
  { value: "any", label: "Any score" },
  { value: "2", label: "Score ≥ 2" },
  { value: "4", label: "Score ≥ 4" },
  { value: "8", label: "Score ≥ 8" },
] as const;

const SEGMENT_GROUPS: { kind: SegmentFacetKind; label: string }[] = [
  { kind: "plan", label: "Plan" },
  { kind: "company_size", label: "Company size" },
  { kind: "trait", label: "Other traits" },
];

function segmentValue(filter: SegmentFilter | null): string {
  return filter ? JSON.stringify([filter.key, filter.value]) : "";
}

function parseSegmentValue(value: string): SegmentFilter | null {
  if (value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { key: parsed[0], value: parsed[1] };
    }
  } catch {
    // A stale option value falls back to "all requesters".
  }
  return null;
}

const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "j / ↓", action: "Select the next request" },
  { keys: "k / ↑", action: "Select the previous request" },
  { keys: "x", action: "Add or remove the selected request from the bulk selection" },
  { keys: "/", action: "Focus the search field" },
  { keys: "Esc", action: "Clear the bulk selection" },
];

export function FeedbackView({
  workspaceSlug,
  productSlug,
  initialPostId,
  boards,
}: {
  workspaceSlug: string;
  productSlug: string;
  initialPostId?: string | undefined;
  boards: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { state } = useDashboard();
  const { open: shortcutsOpen, setOpen: setShortcutsOpen } = useShortcuts();
  usePageShortcuts(KEYBOARD_SHORTCUTS);
  const [density] = useDensity("feedback");
  const relativeNow = new Date(state.liveNow);
  const context = getRouteContext(state, workspaceSlug, productSlug);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const [category, setCategory] = useState<FeedbackCategory | "all">("all");
  const [sort, setSort] = useState<FeedbackViewSort>("newest");
  const [customFieldSort, setCustomFieldSort] =
    useState<FeedbackCustomFieldSort | null>(null);
  const [minScore, setMinScore] = useState<number | null>(null);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [staleFilter, setStaleFilter] = useState<FeedbackAttentionFilter>("all");
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(initialPostId ?? null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeViewId, setActiveViewId] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [saveViewError, setSaveViewError] = useState<string | null>(null);
  const [bulkBusy, startBulk] = useTransition();
  const [lastBulk, setLastBulk] = useState<{ undoId: string; label: string } | null>(null);
  const [viewBusy, startView] = useTransition();
  const detailRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const feedback = useMemo(
    () => (context ? getFeedbackForProduct(state, context.product.id) : []),
    [state, context],
  );

  const productFields = useMemo(
    () => (context ? getCustomFieldsForProduct(state, context.product.id) : []),
    [state, context],
  );
  const productTags = useMemo(
    () =>
      context
        ? state.feedbackTags.filter((tag) => tag.productId === context.product.id)
        : [],
    [state.feedbackTags, context],
  );
  const activeFields = useMemo(
    () => productFields.filter((field) => field.archivedAt === null),
    [productFields],
  );

  // Only public team comments are replies; an internal note is the team talking
  // to itself, and it must not reset the "waiting on us" clock.
  const lastTeamReplyByPost = useMemo(() => {
    const latest = new Map<string, string>();
    for (const comment of state.feedbackComments) {
      if (comment.authorType !== "team" || comment.internal) continue;
      const current = latest.get(comment.postId);
      if (!current || Date.parse(comment.createdAt) > Date.parse(current)) {
        latest.set(comment.postId, comment.createdAt);
      }
    }
    return latest;
  }, [state.feedbackComments]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const attentionNow = new Date(state.liveNow);
    const rows = feedback.filter((post) => {
      if (status !== "all" && post.status !== status) return false;
      if (category !== "all" && post.category !== category) return false;
      if (minScore !== null) {
        const score = getPrioritySignals(state, post.id).priorityScore;
        if (score === null || score < minScore) return false;
      }
            if (
        segmentFilter &&
        !requestMatchesSegment(
          segmentFilter,
          getRequesterSegmentsForPost(state, post.id),
        )
      ) {
        return false;
      }
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "me") {
          if (post.assigneeId !== state.currentUser.id) return false;
        } else if (assigneeFilter === "unassigned") {
          if (post.assigneeId !== null) return false;
        } else if (post.assigneeId !== assigneeFilter) {
          return false;
        }
      }
      if (
        !matchesAttention(
          {
            status: post.status,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            lastTeamReplyAt: lastTeamReplyByPost.get(post.id) ?? null,
          },
          staleFilter,
          attentionNow,
        )
      ) {
        return false;
      }
      if (
        !matchesCustomFieldFilters(
          activeFields,
          state.feedbackCustomFieldValues,
          post.id,
          customFieldFilters,
        )
      ) {
        return false;
      }
      if (!needle) return true;
      return [post.title, post.description, post.authorName, post.company ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    const newestFirst = (a: FeedbackPost, b: FeedbackPost) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

    return rows.sort((a, b) => {
      if (customFieldSort) {
        const field = activeFields.find((candidate) => candidate.key === customFieldSort.key);
        if (field) {
          const left = customFieldValueFor(
            state.feedbackCustomFieldValues,
            a.id,
            field.id,
          );
          const right = customFieldValueFor(
            state.feedbackCustomFieldValues,
            b.id,
            field.id,
          );
          // Missing values stay last in both directions; ties fall back to the
          // normal newest-first order so the list is stable.
          if (left === undefined && right === undefined) return newestFirst(a, b);
          if (left === undefined) return 1;
          if (right === undefined) return -1;
          const compared = compareCustomFieldValues(field.type, left, right);
          if (compared !== 0) {
            return customFieldSort.direction === "asc" ? compared : -compared;
          }
          return newestFirst(a, b);
        }
      }
      if (sort === "oldest") return newestFirst(b, a);
      if (sort !== "newest") {
        return comparePostsBySignal(
          a,
          b,
          (postId) => getPrioritySignals(state, postId),
          (postId) => getVoteCount(state, postId),
          sort,
        );
      }
      return newestFirst(a, b);
    });
  }, [
    feedback,
    search,
    status,
    category,
    sort,
    customFieldSort,
    state,
    activeFields,
    customFieldFilters,
    minScore,
    segmentFilter,
    assigneeFilter,
    staleFilter,
    lastTeamReplyByPost,
  ]);

  const savedViews = useMemo(
    () =>
      context
        ? state.feedbackSavedViews.filter(
            (view) => view.productId === context.product.id,
          )
        : [],
    [state.feedbackSavedViews, context],
  );
  // A stale id stops counting as the active view as soon as a filter differs;
  // this is derived rather than synchronized in an effect.
  const activeView: FeedbackSavedView | null =
    savedViews.find(
      (view) =>
        view.id === activeViewId &&
        view.filters.search === search &&
        view.filters.status === status &&
        view.filters.category === category &&
        view.filters.sort === sort &&
        JSON.stringify(view.filters.customFieldSort ?? null) ===
          JSON.stringify(customFieldSort) &&
        (view.filters.minScore ?? null) === minScore &&
        (view.filters.assignee ?? "all") === assigneeFilter &&
        (view.filters.stale ?? "all") === staleFilter &&
        JSON.stringify(view.filters.segment ?? null) ===
          JSON.stringify(segmentFilter) &&
        JSON.stringify(view.filters.customFields ?? {}) ===
          JSON.stringify(customFieldFilters),
    ) ?? null;
  const selected = selectedId ? getFeedbackById(state, selectedId) : null;
  const activePost =
    (selected && filtered.some((post) => post.id === selected.id) ? selected : null) ??
    filtered[0] ??
    null;
  const visible = filtered.slice(0, visibleCount);
  const allVisibleSelected =
    visible.length > 0 && visible.every((post) => selectedIds.has(post.id));
  const someVisibleSelected = visible.some((post) => selectedIds.has(post.id));

  const selectPost = useCallback((postId: string) => {
    setSelectedId(postId);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  const moveActive = useCallback(
    (delta: number) => {
      if (filtered.length === 0) return;
      const currentIndex = activePost
        ? filtered.findIndex((post) => post.id === activePost.id)
        : -1;
      const nextIndex = Math.min(
        filtered.length - 1,
        Math.max(0, currentIndex + delta),
      );
      const next = filtered[nextIndex];
      if (!next) return;
      selectPost(next.id);
      requestAnimationFrame(() => rowRefs.current.get(next.id)?.focus());
    },
    [activePost, filtered, selectPost],
  );

  const toggleActiveSelection = useCallback(() => {
    if (!activePost) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(activePost.id)) next.delete(activePost.id);
      else next.add(activePost.id);
      return next;
    });
  }, [activePost]);

  function applyFilters(filters: FeedbackSavedViewFilters): void {
    setSearch(filters.search);
    setStatus(filters.status);
    setCategory(filters.category);
    setSort(filters.sort);
    setCustomFieldSort(filters.customFieldSort ?? null);
    setMinScore(filters.minScore ?? null);
    setSegmentFilter(filters.segment ?? null);
    setAssigneeFilter(filters.assignee ?? "all");
    setStaleFilter(filters.stale ?? "all");
    setCustomFieldFilters(filters.customFields ?? {});
    setVisibleCount(PAGE_SIZE);
    setSelectedIds(new Set());
  }

  function applySavedView(value: string): void {
    if (value === "all") {
      setActiveViewId("all");
      applyFilters(DEFAULT_FILTERS);
      return;
    }
    const view = savedViews.find((candidate) => candidate.id === value);
    if (!view) return;
    setActiveViewId(view.id);
    applyFilters(view.filters);
  }

  useEffect(() => {
    const selectAll = selectAllRef.current;
    if (selectAll) {
      selectAll.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (shortcutsOpen || saveViewOpen) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("feedback-search")?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          setSelectedIds(new Set());
        }
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(1);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(-1);
        return;
      }
      if (event.key === "x") {
        event.preventDefault();
        toggleActiveSelection();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    moveActive,
    saveViewOpen,
    selectedIds.size,
    shortcutsOpen,
    toggleActiveSelection,
  ]);

  if (!context) {
    return (
      <EmptyState
        title="Product not found"
        description="This workspace or product is not available to your account."
      />
    );
  }

  const { workspace, product, role } = context;
  const timeZone = workspace.timezone;
  const canWrite = hasPermission(role, "feedback:write");
  const canComment = hasPermission(role, "feedback:comment");
  const canModerate = hasPermission(role, "moderation:manage");

  function toggleSelected(postId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function toggleAllVisible(): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const post of visible) next.delete(post.id);
      } else {
        for (const post of visible) next.add(post.id);
      }
      return next;
    });
  }

  function handleSaveView(event: FormEvent): void {
    event.preventDefault();
    setSaveViewError(null);
    startView(async () => {
      const result = await saveFeedbackViewAction({
        workspaceSlug,
        productSlug,
        name: viewName,
        filters: {
          search,
          status,
          category,
          sort,
          customFieldSort,
          customFields: customFieldFilters,
          minScore,
          segment: segmentFilter,
          assignee: assigneeFilter,
          stale: staleFilter,
        },
      });
      if (!result.ok) {
        setSaveViewError(result.error);
        return;
      }
      setActiveViewId(result.data.view.id);
      setSaveViewOpen(false);
      setViewName("");
      router.refresh();
    });
  }

  function handleDeleteView(): void {
    if (!activeView) return;
    startView(async () => {
      const result = await deleteFeedbackViewAction({
        workspaceSlug,
        productSlug,
        viewId: activeView.id,
      });
      if (!result.ok) {
        toast.error("Could not delete that view", { description: result.error });
        return;
      }
      setActiveViewId("all");
      router.refresh();
    });
  }

  function bulkStatus(value: string): void {
    if (selectedIds.size === 0) return;
    const nextStatus = value as FeedbackStatus;
    startBulk(async () => {
      const result = await bulkUpdateFeedbackStatusAction({
        workspaceSlug,
        productSlug,
        postIds: [...selectedIds],
        status: nextStatus,
      });
      if (!result.ok) {
        toast.error("Could not update those requests", { description: result.error });
        return;
      }
      toast.success(
        `Updated ${result.data.updated} request${result.data.updated === 1 ? "" : "s"}`,
        result.data.skipped > 0
          ? {
              description: `${result.data.skipped} merged duplicate${
                result.data.skipped === 1 ? " was" : "s were"
              } skipped.`,
            }
          : undefined,
      );
      if (result.data.undoId) {
        setLastBulk({
          undoId: result.data.undoId,
          label: `Updated ${result.data.updated} request${result.data.updated === 1 ? "" : "s"}`,
        });
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function bulkVisibility(hidden: boolean): void {
    if (selectedIds.size === 0) return;
    startBulk(async () => {
      const result = await bulkSetFeedbackHiddenAction({
        workspaceSlug,
        productSlug,
        postIds: [...selectedIds],
        hidden,
      });
      if (!result.ok) {
        toast.error("Could not change visibility", { description: result.error });
        return;
      }
      toast.success(
        `${hidden ? "Hidden" : "Restored"} ${result.data.updated} request${
          result.data.updated === 1 ? "" : "s"
        }`,
      );
      if (result.data.undoId) {
        setLastBulk({
          undoId: result.data.undoId,
          label: `${hidden ? "Hidden" : "Restored"} ${result.data.updated} request${
            result.data.updated === 1 ? "" : "s"
          }`,
        });
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function bulkAssignee(value: string): void {
    if (selectedIds.size === 0) return;
    const assigneeId = value === "unassigned" ? null : value;
    startBulk(async () => {
      const result = await bulkAssignFeedbackAction({
        workspaceSlug,
        productSlug,
        postIds: [...selectedIds],
        assigneeId,
      });
      if (!result.ok) {
        toast.error("Could not assign those requests", { description: result.error });
        return;
      }
      const label = assigneeId
        ? `Assigned ${result.data.updated} request${result.data.updated === 1 ? "" : "s"}`
        : `Unassigned ${result.data.updated} request${result.data.updated === 1 ? "" : "s"}`;
      toast.success(
        label,
        result.data.skipped > 0
          ? { description: `${result.data.skipped} merged duplicate${result.data.skipped === 1 ? " was" : "s were"} skipped.` }
          : undefined,
      );
      if (result.data.undoId) {
        setLastBulk({ undoId: result.data.undoId, label });
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function bulkTag(value: string): void {
    if (selectedIds.size === 0) return;
    startBulk(async () => {
      const result = await bulkTagFeedbackAction({
        workspaceSlug,
        productSlug,
        postIds: [...selectedIds],
        tagId: value,
      });
      if (!result.ok) {
        toast.error("Could not tag those requests", { description: result.error });
        return;
      }
      const label = `Tagged ${result.data.updated} request${result.data.updated === 1 ? "" : "s"}`;
      toast.success(
        label,
        result.data.skipped > 0
          ? {
              description: `${result.data.skipped} skipped (another board, merged, or already at ten tags).`,
            }
          : undefined,
      );
      if (result.data.undoId) {
        setLastBulk({ undoId: result.data.undoId, label });
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function bulkMoveBoard(value: string): void {
    if (selectedIds.size === 0) return;
    startBulk(async () => {
      const result = await bulkMoveFeedbackBoardAction({
        workspaceSlug,
        productSlug,
        postIds: [...selectedIds],
        boardId: value,
      });
      if (!result.ok) {
        toast.error("Could not move those requests", { description: result.error });
        return;
      }
      const label = `Moved ${result.data.updated} request${result.data.updated === 1 ? "" : "s"}`;
      toast.success(label, {
        description:
          result.data.skipped > 0
            ? `${result.data.skipped} merged duplicate${result.data.skipped === 1 ? " was" : "s were"} skipped. Tags from the old board were cleared.`
            : "Tags from the old board were cleared.",
      });
      if (result.data.undoId) {
        setLastBulk({ undoId: result.data.undoId, label });
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function undoLastBulk(): void {
    if (!lastBulk) return;
    startBulk(async () => {
      const result = await undoFeedbackBulkActionAction({
        workspaceSlug,
        productSlug,
        undoId: lastBulk.undoId,
      });
      if (!result.ok) {
        toast.error("Could not undo that action", { description: result.error });
        return;
      }
      toast.success(
        `Restored ${result.data.restored} request${result.data.restored === 1 ? "" : "s"}`,
      );
      setLastBulk(null);
      router.refresh();
    });
  }

  const filterSummary =
    [
      search.trim() ? `Search “${search.trim()}”` : null,
      status === "all" ? null : FEEDBACK_STATUS_LABELS[status],
      category === "all" ? null : FEEDBACK_CATEGORY_LABELS[category],
      sort === "newest" || customFieldSort
        ? null
        : SORT_OPTIONS.find((option) => option.value === sort)?.label,
      customFieldSort
        ? `${activeFields.find((field) => field.key === customFieldSort.key)?.label ?? customFieldSort.key} ${
            customFieldSort.direction === "asc" ? "↑" : "↓"
          }`
        : null,
      minScore === null ? null : `Score ≥ ${minScore}`,
      segmentFilter
        ? `Segment ${segmentFilter.key}=${segmentFilter.value}`
        : null,
      assigneeFilter === "all"
        ? null
        : assigneeFilter === "me"
          ? "My requests"
          : assigneeFilter === "unassigned"
            ? "Unassigned"
            : `Assignee ${state.teamMembers.find((member) => member.id === assigneeFilter)?.name ?? "member"}`,
      staleFilter === "all"
        ? null
        : ATTENTION_OPTIONS.find((option) => option.value === staleFilter)?.label,
      Object.values(customFieldFilters).filter((value) => value.trim() !== "").length > 0
        ? `${Object.values(customFieldFilters).filter((value) => value.trim() !== "").length} custom field${
            Object.values(customFieldFilters).filter((value) => value.trim() !== "").length === 1
              ? ""
              : "s"
          }`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No filters — all requests, newest first";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description={`Requests collected from ${product.name} customers. Status is the roadmap; link a request to a release so shipping travels with it.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/feedback/duplicates`}>
              <Merge aria-hidden="true" />
              Duplicate triage
            </Link>
          </Button>
        }
        meta={
          <>
            <span>{feedback.length} requests in this product</span>
            <span aria-hidden="true">·</span>
            <span>{feedback.filter((post) => !["shipped", "closed"].includes(post.status)).length} open</span>
            <span aria-hidden="true">·</span>
            <span>Internal notes are never shown publicly</span>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px] xl:items-start">
        <div className="min-w-0 space-y-3">
          <div className="space-y-2">
            <Toolbar>
              <ToolbarGroup className="w-full">
                <SearchInput
                  inputId="feedback-search"
                  value={search}
                  onChange={(value) => {
                    setSearch(value);
                    setVisibleCount(PAGE_SIZE);
                    setSelectedIds(new Set());
                  }}
                  placeholder="Search requests…"
                  label="Search feedback"
                />
                <ListDensityToggle surface="feedback" label="Feedback" />
                <ResultCount
                  shown={visible.length}
                  total={filtered.length}
                  noun="requests"
                  className="ml-auto shrink-0"
                />
              </ToolbarGroup>
            </Toolbar>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-2">
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value as FeedbackStatus | "all");
                  setVisibleCount(PAGE_SIZE);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger size="sm" className="w-full bg-background" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all" ? "All statuses" : FEEDBACK_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value as FeedbackCategory | "all");
                  setVisibleCount(PAGE_SIZE);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger size="sm" className="w-full bg-background" aria-label="Filter by category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all" ? "All categories" : FEEDBACK_CATEGORY_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={assigneeFilter}
                onValueChange={(value) => {
                  setAssigneeFilter(value);
                  setVisibleCount(PAGE_SIZE);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full bg-background"
                  aria-label="Filter by assignee"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any assignee</SelectItem>
                  <SelectItem value="me">My requests</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {state.teamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={staleFilter}
                onValueChange={(value) => {
                  setStaleFilter(value as FeedbackAttentionFilter);
                  setVisibleCount(PAGE_SIZE);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full bg-background"
                  aria-label="Filter by attention"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTENTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={minScore === null ? "any" : String(minScore)}
                onValueChange={(value) => {
                  setMinScore(value === "any" ? null : Number(value));
                  setVisibleCount(PAGE_SIZE);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full bg-background"
                  aria-label="Filter by priority score"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCORE_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  {minScore !== null &&
                  !SCORE_FILTER_OPTIONS.some(
                    (option) => option.value === String(minScore),
                  ) ? (
                    <SelectItem value={String(minScore)}>
                      Score ≥ {minScore}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <Select
                value={
                  customFieldSort
                    ? `custom_field:${customFieldSort.key}:${customFieldSort.direction}`
                    : sort
                }
                onValueChange={(value) => {
                  if (value.startsWith("custom_field:")) {
                    const [, key, direction] = value.split(":");
                    const field = activeFields.find((candidate) => candidate.key === key);
                    if (field && (direction === "asc" || direction === "desc")) {
                      setCustomFieldSort({ key: field.key, direction });
                    }
                  } else {
                    setCustomFieldSort(null);
                    setSort(value as FeedbackViewSort);
                  }
                  setVisibleCount(PAGE_SIZE);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full bg-background"
                  aria-label="Sort feedback"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  {activeFields.flatMap((field) => [
                    <SelectItem
                      key={`custom_field:${field.key}:asc`}
                      value={`custom_field:${field.key}:asc`}
                    >
                      {field.label} ↑
                    </SelectItem>,
                    <SelectItem
                      key={`custom_field:${field.key}:desc`}
                      value={`custom_field:${field.key}:desc`}
                    >
                      {field.label} ↓
                    </SelectItem>,
                  ])}
                </SelectContent>
              </Select>
            </div>
          </div>

          {state.segmentFacets.length > 0 || segmentFilter ? (
            <details className="rounded-lg border bg-card px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Requester segment
                {segmentFilter
                  ? ` · ${segmentFilter.key}=${segmentFilter.value}`
                  : ""}
              </summary>
              <div className="mt-3 max-w-md space-y-1.5">
                <Label htmlFor="inbox-segment" className="text-xs">
                  Segment
                </Label>
                <select
                  id="inbox-segment"
                  value={segmentValue(segmentFilter)}
                  onChange={(event) => {
                    setSegmentFilter(parseSegmentValue(event.target.value));
                    setVisibleCount(PAGE_SIZE);
                    setSelectedIds(new Set());
                  }}
                  className={FIELD_FILTER_CLASS}
                >
                  <option value="">All requesters</option>
                  {segmentFilter &&
                  !state.segmentFacets.some(
                    (facet) =>
                      facet.key === segmentFilter.key &&
                      facet.value === segmentFilter.value,
                  ) ? (
                    <option value={segmentValue(segmentFilter)}>
                      {segmentFilter.key}: {segmentFilter.value} (no longer stored)
                    </option>
                  ) : null}
                  {SEGMENT_GROUPS.map((group) => {
                    const options = state.segmentFacets.filter(
                      (facet) => facet.kind === group.kind,
                    );
                    if (options.length === 0) return null;
                    return (
                      <optgroup key={group.kind} label={group.label}>
                        {options.map((facet) => (
                          <option
                            key={`${facet.key}:${facet.value}`}
                            value={segmentValue(facet)}
                          >
                            {facet.kind === "trait"
                              ? `${facet.key}: ${facet.value}`
                              : facet.value}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Matches requests with at least one requester whose stored plan, company size
                  or other trait equals this value. Values come from customer and company
                  traits; nothing is inferred.
                </p>
              </div>
            </details>
          ) : null}

          {activeFields.length > 0 ? (
            <details className="rounded-lg border bg-card px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Custom fields
                {Object.values(customFieldFilters).some((value) => value.trim() !== "")
                  ? ` · ${
                      Object.values(customFieldFilters).filter(
                        (value) => value.trim() !== "",
                      ).length
                    } active`
                  : ""}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {activeFields.map((field) => {
                  const id = `inbox-field-${field.key}`;
                  const update = (value: string) => {
                    setCustomFieldFilters((current) => {
                      const next = { ...current };
                      if (value.trim() === "") delete next[field.key];
                      else next[field.key] = value;
                      return next;
                    });
                    setVisibleCount(PAGE_SIZE);
                    setSelectedIds(new Set());
                  };

                  return (
                    <div key={field.id} className="space-y-1.5">
                      <Label htmlFor={id} className="text-xs">
                        {field.label}
                      </Label>
                      {field.type === "select" ? (
                        <select
                          id={id}
                          value={customFieldFilters[field.key] ?? ""}
                          onChange={(event) => update(event.target.value)}
                          className={FIELD_FILTER_CLASS}
                        >
                          <option value="">Any</option>
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={id}
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "date"
                                ? "date"
                                : "text"
                          }
                          value={customFieldFilters[field.key] ?? ""}
                          onChange={(event) => update(event.target.value)}
                          placeholder="Any"
                          className="h-8 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={activeView?.id ?? "all"} onValueChange={applySavedView}>
              <SelectTrigger
                size="sm"
                className="w-48 bg-background"
                aria-label="Saved view"
              >
                <SelectValue placeholder="All requests" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All requests</SelectItem>
                {savedViews.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {view.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSaveViewError(null);
                setViewName(activeView?.name ?? "");
                setSaveViewOpen(true);
              }}
            >
              <Save aria-hidden="true" />
              Save view
            </Button>
            {activeView ? (
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete saved view ${activeView.name}`}
                    disabled={viewBusy}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                }
                title={`Delete the “${activeView.name}” view?`}
                description="The view is removed from your account. The requests and their filters are not affected."
                confirmLabel="Delete view"
                onConfirm={handleDeleteView}
              />
            ) : null}
            {canWrite ? (
              <OnBehalfDialog
                workspaceSlug={workspaceSlug}
                productSlug={productSlug}
                mode="submit"
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setShortcutsOpen(true)}
            >
              <Keyboard aria-hidden="true" />
              <span className="hidden sm:inline">Shortcuts</span>
            </Button>
            <span className="hidden items-center gap-1 text-[11px] text-muted-foreground xl:flex">
              <kbd className="rounded border bg-muted px-1 font-sans">j</kbd>
              <kbd className="rounded border bg-muted px-1 font-sans">k</kbd>
              navigate ·
              <kbd className="rounded border bg-muted px-1 font-sans">x</kbd>
              select ·
              <kbd className="rounded border bg-muted px-1 font-sans">?</kbd>
              help
            </span>
          </div>

          {lastBulk ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-muted/30 p-2"
            >
              <span className="text-xs text-muted-foreground">
                Bulk action applied: {lastBulk.label}.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={undoLastBulk}
                disabled={bulkBusy}
              >
                <RotateCcw aria-hidden="true" />
                {bulkBusy ? "Undoing…" : "Undo"}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="ml-auto size-6"
                aria-label="Dismiss the bulk undo"
                onClick={() => setLastBulk(null)}
                disabled={bulkBusy}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : null}

          {selectedIds.size > 0 ? (
            <div
              role="region"
              aria-label="Bulk actions"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2"
            >
              <span className="text-xs font-medium tabular-nums">
                {selectedIds.size} selected
              </span>
              <Select onValueChange={bulkStatus} disabled={!canWrite || bulkBusy}>
                <SelectTrigger
                  size="sm"
                  className="w-40 bg-background"
                  aria-label="Set status for selected requests"
                >
                  <SelectValue placeholder="Set status…" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.filter((option) => option !== "all").map((option) => (
                    <SelectItem key={option} value={option}>
                      {FEEDBACK_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select onValueChange={bulkAssignee} disabled={!canWrite || bulkBusy}>
                <SelectTrigger
                  size="sm"
                  className="w-36 bg-background"
                  aria-label="Assign selected requests"
                >
                  <SelectValue placeholder="Assign to…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {state.teamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                onValueChange={bulkTag}
                disabled={!canWrite || bulkBusy || productTags.length === 0}
              >
                <SelectTrigger
                  size="sm"
                  className="w-32 bg-background"
                  aria-label="Tag selected requests"
                >
                  <SelectValue placeholder="Add tag…" />
                </SelectTrigger>
                <SelectContent>
                  {productTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                onValueChange={bulkMoveBoard}
                disabled={!canWrite || bulkBusy || boards.length === 0}
              >
                <SelectTrigger
                  size="sm"
                  className="w-40 bg-background"
                  aria-label="Move selected requests to a board"
                >
                  <SelectValue placeholder="Move to board…" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canModerate ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => bulkVisibility(true)}
                    disabled={bulkBusy}
                  >
                    <EyeOff aria-hidden="true" />
                    Hide
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => bulkVisibility(false)}
                    disabled={bulkBusy}
                  >
                    <Eye aria-hidden="true" />
                    Restore
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkBusy}
                className="ml-auto"
              >
                <X aria-hidden="true" />
                Clear
              </Button>
              {bulkBusy ? (
                <span className="text-[11px] text-muted-foreground">Working…</span>
              ) : null}
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No requests match"
              description="Try a different status, category or search term."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveViewId("all");
                    applyFilters(DEFAULT_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2">
                <input
                  ref={selectAllRef}
                  id="feedback-select-all"
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  className="size-4 accent-primary"
                />
                <label
                  htmlFor="feedback-select-all"
                  className="cursor-pointer text-xs font-medium"
                >
                  Select all visible
                </label>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${filtered.length} matching`}
                </span>
              </div>
              <ul className="divide-y" aria-label="Feedback requests">
                {visible.map((post) => {
                  const votes = getVoteCount(state, post.id);
                  const comments = getCommentsForPost(state, post.id);
                  const publicComments = comments.filter((comment) => !comment.internal).length;
                  const internalNotes = comments.filter((comment) => comment.internal).length;
                  const active = activePost?.id === post.id;
                  const isSelected = selectedIds.has(post.id);
                  const postTagIds = new Set(
                    state.feedbackTagLinks
                      .filter((link) => link.postId === post.id)
                      .map((link) => link.tagId),
                  );
                  const tags = state.feedbackTags.filter((tag) =>
                    postTagIds.has(tag.id),
                  );

                  return (
                    <li key={post.id} className={cn(isSelected && "bg-primary/5")}>
                      <div
                        className={`flex items-start gap-1.5 px-2 sm:gap-2 sm:px-3 ${
                          density === "compact" ? "py-1" : "py-2"
                        }`}
                      >
                        <label className="mt-3 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(post.id)}
                            aria-label={`Select ${post.title}`}
                            className="size-4 accent-primary"
                          />
                        </label>
                        <button
                          type="button"
                          ref={(element) => {
                            if (element) rowRefs.current.set(post.id, element);
                            else rowRefs.current.delete(post.id);
                          }}
                          onClick={() => selectPost(post.id)}
                          aria-pressed={active}
                          className={cn(
                            "flex min-w-0 flex-1 items-start gap-3 rounded-md px-1 py-1 text-left transition-colors",
                            active ? "bg-primary/5" : "hover:bg-muted/40",
                          )}
                        >
                          <VoteCountBox count={votes} className="mt-0.5 bg-background" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{post.title}</span>
                              {post.mergedIntoId ? (
                                <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  Merged
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                              <span>{post.authorName}</span>
                              {post.company ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{post.company}</span>
                                </>
                              ) : null}
                              <span aria-hidden="true">·</span>
                              <span>{formatRelative(post.createdAt, relativeNow)}</span>
                              {publicComments > 0 ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <MessagesSquare className="size-3" aria-hidden="true" />
                                    {publicComments}
                                  </span>
                                </>
                              ) : null}
                              {internalNotes > 0 ? (
                                <span className="inline-flex items-center gap-1 text-warning">
                                  <Lock className="size-3" aria-hidden="true" />
                                  {internalNotes} internal
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <FeedbackStatusBadge status={post.status} />
                              <FeedbackCategoryBadge category={post.category} />
                              {tags.map((tag) => (
                                <TagChip
                                  key={tag.id}
                                  name={tag.name}
                                  color={tag.color}
                                  className="text-[10px]"
                                />
                              ))}
                            </span>
                            <PrioritisationSignals
                              signals={getPrioritySignals(state, post.id)}
                              className="mt-1.5"
                            />
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {visibleCount < filtered.length ? (
                <div className="border-t p-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  >
                    Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div ref={detailRef} className="min-w-0 scroll-mt-20 xl:sticky xl:top-20">
          {activePost ? (
            <FeedbackDetail
              key={activePost.id}
              post={activePost}
              workspaceSlug={workspaceSlug}
              productSlug={productSlug}
              timeZone={timeZone}
              canWrite={canWrite}
              canComment={canComment}
              canModerate={canModerate}
              onSelectPost={selectPost}
            />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Select a request"
              description="Choose a feedback request to read its details, comments and linked release."
            />
          )}
        </div>
      </div>

      <Dialog
        open={saveViewOpen}
        onOpenChange={(open) => {
          setSaveViewOpen(open);
          if (!open) setSaveViewError(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleSaveView} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Save this view</DialogTitle>
              <DialogDescription>
                Saved views are private to your account. Saving an existing name updates that
                view with the current filters.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="saved-view-name">View name</Label>
              <Input
                id="saved-view-name"
                value={viewName}
                onChange={(event) => {
                  setViewName(event.target.value);
                  setSaveViewError(null);
                }}
                maxLength={40}
                placeholder="For example, Planned this quarter"
                aria-invalid={Boolean(saveViewError)}
                aria-describedby={saveViewError ? "saved-view-error" : undefined}
                autoFocus
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Filters: {filterSummary}
              </p>
            </div>
            {saveViewError ? (
              <p id="saved-view-error" role="alert" className="text-xs font-medium text-destructive">
                {saveViewError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveViewOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={viewBusy || viewName.trim() === ""}>
                {viewBusy ? "Saving…" : "Save view"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function FeedbackDetail({
  post,
  workspaceSlug,
  productSlug,
  timeZone,
  canWrite,
  canComment,
  canModerate,
  onSelectPost,
}: {
  post: FeedbackPost;
  workspaceSlug: string;
  productSlug: string;
  timeZone: string;
  canWrite: boolean;
  canComment: boolean;
  canModerate: boolean;
  onSelectPost: (postId: string) => void;
}) {
  const router = useRouter();
  const { state } = useDashboard();
  const relativeNow = new Date(state.liveNow);
  const context = getRouteContext(state, workspaceSlug, productSlug);
  const productFields = context
    ? getCustomFieldsForProduct(state, context.product.id).filter(
        (field) => field.archivedAt === null,
      )
    : [];
  const storedFieldValues = getCustomFieldValuesForPost(state, post.id);
  const storedPriority = getPrioritisationForPost(state, post.id);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      productFields.map((field) => {
        const value = customFieldValueFor(storedFieldValues, post.id, field.id);
        return [field.key, value === undefined ? "" : String(value)];
      }),
    ),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fieldBusy, startFields] = useTransition();
  const [impact, setImpact] = useState(
    storedPriority?.impact ? String(storedPriority.impact) : "",
  );
  const [businessValue, setBusinessValue] = useState(
    storedPriority?.businessValue ? String(storedPriority.businessValue) : "",
  );
  const [effort, setEffort] = useState(
    storedPriority?.effort ? String(storedPriority.effort) : "",
  );
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [priorityBusy, startPriority] = useTransition();
  const [commentMode, setCommentMode] = useState<"public" | "internal">("public");
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [tagChoice, setTagChoice] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [tagBusy, startTag] = useTransition();
  const [visibilityBusy, startVisibility] = useTransition();
  const [banBusy, startBan] = useTransition();
  const [assigneeBusy, startAssignee] = useTransition();
  const [plannedFor, setPlannedForValue] = useState(post.plannedFor ?? "");
  const [plannedBusy, startPlanned] = useTransition();
  const [insightQuote, setInsightQuote] = useState("");
  const [insightSource, setInsightSource] = useState<InsightSource>("support");
  const [insightAuthor, setInsightAuthor] = useState("");
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightBusy, startInsight] = useTransition();
  const [contextKind, setContextKind] = useState<"help_article" | "changelog">(
    "help_article",
  );
  const [contextRefId, setContextRefId] = useState("");
  const [contextBusy, startContext] = useTransition();

  if (!context) return null;

  const votes = getVoteCount(state, post.id);
  const voted = hasUserVoted(state, post.id);
  const comments = getCommentsForPost(state, post.id);
  const publicComments = comments.filter((comment) => !comment.internal);
  const internalNotes = comments.filter((comment) => comment.internal);
  const releases = getReleasesForProduct(state, context.product.id);
  const linkedRelease = releases.find((release) => release.id === post.releaseId);
  const mergedInto = post.mergedIntoId ? getFeedbackById(state, post.mergedIntoId) : null;
  const mergedTargets = getFeedbackForProduct(state, context.product.id).filter(
    (candidate) => candidate.id !== post.id && candidate.mergedIntoId === null,
  );
  const boardTags = state.feedbackTags.filter((tag) => tag.boardId === post.boardId);
  const postTagIds = new Set(
    state.feedbackTagLinks
      .filter((link) => link.postId === post.id)
      .map((link) => link.tagId),
  );
  const postTags = boardTags.filter((tag) => postTagIds.has(tag.id));
  const availableTags = boardTags.filter((tag) => !postTagIds.has(tag.id));
  const insights = state.feedbackInsights.filter(
    (insight) => insight.postId === post.id,
  );
  const demand = summarizeRequestDemand(insights);
  const contextLinks = state.feedbackContextLinks.filter(
    (link) => link.postId === post.id,
  );
  const contextOptions =
    contextKind === "help_article"
      ? state.helpArticles.map((article) => ({
          id: article.id,
          label: `${article.title} · ${article.status}`,
        }))
      : releases.map((release) => ({
          id: release.id,
          label: `${release.title} · ${release.status}`,
        }));

  // Ranked with the same scorer as the public submit page, so "these two are
  // probably the same request" means one thing across the product. Computed
  // directly rather than memoised: the detail renders below an early return, so
  // adding a hook here would break the hook order.
  const mergeSuggestions = rankSimilar(
    { title: post.title, body: post.description },
    getFeedbackForProduct(state, post.productId)
      .filter(
        (candidate) =>
          candidate.id !== post.id &&
          candidate.mergedIntoId === null &&
          candidate.hiddenAt === null &&
          !["shipped", "closed"].includes(candidate.status),
      )
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        body: candidate.description,
      })),
    { limit: 3, excludeIds: [post.id] },
  );

  function handleVote() {
    if (!canWrite) {
      toast.error("You cannot vote with your current role.");
      return;
    }
    void toggleFeedbackVoteAction({ workspaceSlug, productSlug, postId: post.id }).then(
      (result) => {
        if (!result.ok) {
          toast.error("Could not save that vote", { description: result.error });
          return;
        }
        router.refresh();
      },
    );
  }

  function handleStatus(value: string) {
    const status = value as FeedbackStatus;
    void updateFeedbackStatusAction({
      workspaceSlug,
      productSlug,
      postId: post.id,
      status,
    }).then((result) => {
      if (!result.ok) {
        toast.error("Could not change status", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function handleReleaseLink(value: string) {
    const targetId = value === "none" ? null : value;
    void linkFeedbackToReleaseAction({
      workspaceSlug,
      productSlug,
      postId: post.id,
      targetId,
    }).then((result) => {
      if (!result.ok) {
        toast.error("Could not update the release link", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function saveCustomFields() {
    startFields(async () => {
      setFieldError(null);
      const result = await setCustomFieldValuesAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        values: fieldValues,
      });
      if (!result.ok) {
        setFieldError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function savePriority() {
    const scale = (value: string) => (value === "" ? null : Number(value));
    startPriority(async () => {
      setPriorityError(null);
      const result = await setPrioritisationAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        impact: scale(impact),
        businessValue: scale(businessValue),
        effort: scale(effort),
      });
      if (!result.ok) {
        setPriorityError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function assignAssignee(value: string): void {
    startAssignee(async () => {
      const result = await setFeedbackAssigneeAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        assigneeId: value === "unassigned" ? null : value,
      });
      if (!result.ok) {
        toast.error("Could not change the assignee", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function savePlannedFor(): void {
    startPlanned(async () => {
      const result = await setPlannedForAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        plannedFor: plannedFor.trim() === "" ? null : plannedFor,
      });
      if (!result.ok) {
        toast.error("Could not save that target", { description: result.error });
        return;
      }
      setPlannedForValue(result.data.plannedFor ?? "");
      router.refresh();
    });
  }

  function mergeInto(targetId: string): void {
    startTag(async () => {
      const result = await mergeFeedbackAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        targetId,
      });
      if (!result.ok) {
        toast.error("Could not merge requests", { description: result.error });
        return;
      }
      toast.success("Requests merged", {
        description: "Comments, votes, tags and evidence moved to the canonical request.",
      });
      onSelectPost(targetId);
      router.refresh();
    });
  }

  function saveTags(tagIds: string[]) {
    startTag(async () => {
      const result = await setPostTagsAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        tagIds,
      });
      if (!result.ok) {
        toast.error("Could not save tags", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function addTag(tagId: string) {
    setTagChoice("");
    saveTags([...postTagIds, tagId]);
  }

  function removeTag(tagId: string) {
    saveTags([...postTagIds].filter((id) => id !== tagId));
  }

  function createTag() {
    if (!post.boardId) return;
    const name = newTagName.trim();
    if (name.length === 0) {
      toast.error("Enter a tag name first.");
      return;
    }

    startTag(async () => {
      const created = await createBoardTagAction({
        workspaceSlug,
        productSlug,
        boardId: post.boardId as string,
        name,
        color: null,
      });
      if (!created.ok) {
        toast.error("Could not create that tag", { description: created.error });
        return;
      }

      const assigned = await setPostTagsAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        tagIds: [...postTagIds, created.data.tagId],
      });
      if (!assigned.ok) {
        toast.error("Tag created but not applied", { description: assigned.error });
        return;
      }

      setNewTagName("");
      router.refresh();
    });
  }

  function deleteTag(tagId: string) {
    startTag(async () => {
      const result = await deleteBoardTagAction({
        workspaceSlug,
        productSlug,
        tagId,
      });
      if (!result.ok) {
        toast.error("Could not delete that tag", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function toggleHidden() {
    startVisibility(async () => {
      const result = await setFeedbackHiddenAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        hidden: !post.hiddenAt,
      });
      if (!result.ok) {
        toast.error("Could not change visibility", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function toggleAuthorBan() {
    const customerId = post.authorCustomerId;
    if (!customerId) return;

    startBan(async () => {
      const result = await setCustomerBanAction({
        workspaceSlug,
        productSlug,
        customerId,
        banned: !post.authorBanned,
      });
      if (!result.ok) {
        toast.error("Could not update that customer", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function undoMerge() {
    startTag(async () => {
      const result = await unmergeFeedbackAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
      });
      if (!result.ok) {
        toast.error("Could not undo the merge", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function saveInsight() {
    startInsight(async () => {
      setInsightError(null);
      const result = await addInsightAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        quote: insightQuote,
        source: insightSource,
        authorLabel: insightAuthor.trim() === "" ? null : insightAuthor,
      });
      if (!result.ok) {
        setInsightError(result.error);
        return;
      }
      setInsightQuote("");
      setInsightAuthor("");
      router.refresh();
    });
  }

  function removeInsight(insightId: string) {
    startInsight(async () => {
      const result = await deleteInsightAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        insightId,
      });
      if (!result.ok) {
        toast.error("Could not remove that evidence", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  function attachContext() {
    if (contextRefId === "") return;
    startContext(async () => {
      const result = await addContextLinkAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        kind: contextKind,
        refId: contextRefId,
      });
      if (!result.ok) {
        toast.error("Could not attach that context", { description: result.error });
        return;
      }
      setContextRefId("");
      toast.success(
        result.data.alreadyLinked ? "Already attached" : "Context attached",
      );
      router.refresh();
    });
  }

  function detachContext(linkId: string) {
    startContext(async () => {
      const result = await removeContextLinkAction({
        workspaceSlug,
        productSlug,
        postId: post.id,
        linkId,
      });
      if (!result.ok) {
        toast.error("Could not remove that context", { description: result.error });
        return;
      }
      toast.success("Context removed");
      router.refresh();
    });
  }

  async function handleCommentSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canComment) {
      setCommentError("You do not have permission to comment.");
      return;
    }
    if (commentBody.trim().length < 2) {
      setCommentError("Write at least two characters.");
      return;
    }

    const result = await addFeedbackCommentAction({
      workspaceSlug,
      productSlug,
      postId: post.id,
      body: commentBody,
      internal: commentMode === "internal",
    });
    if (!result.ok) {
      setCommentError(result.error);
      return;
    }
    setCommentBody("");
    setCommentError(null);
    toast.success(commentMode === "internal" ? "Internal note added" : "Comment added", {
      description:
        commentMode === "internal"
          ? "Only visible to the team; never included in public feedback surfaces."
          : "Saved to the database. No notification was sent.",
    });
    router.refresh();
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-2 pb-3">
        {post.hiddenAt ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs leading-relaxed text-destructive">
            <span>
              Hidden from public boards, search and duplicate suggestions by a moderator.
            </span>
            {canModerate ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={toggleHidden}
                disabled={visibilityBusy}
              >
                <Eye aria-hidden="true" />
                {visibilityBusy ? "Restoring…" : "Restore"}
              </Button>
            ) : null}
          </div>
        ) : null}
        {mergedInto ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning-muted p-2.5 text-xs leading-relaxed text-warning">
            <p>
              This request was merged into{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => onSelectPost(mergedInto.id)}
              >
                {mergedInto.title}
              </button>
              . Its comments, votes, reactions, tags and attachments moved there.
            </p>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={undoMerge}
                disabled={tagBusy}
              >
                <RotateCcw aria-hidden="true" />
                {tagBusy ? "Undoing…" : "Undo merge"}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <FeedbackStatusBadge status={post.status} />
              <FeedbackCategoryBadge category={post.category} />
            </div>
            <CardTitle className="mt-2 text-base leading-snug">{post.title}</CardTitle>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" aria-hidden="true" />
                {post.authorName}
                {post.company ? ` · ${post.company}` : ""}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                <DualTimestamp iso={post.createdAt} timeZone={timeZone} />
              </span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
            <CopyBriefButton
              workspaceSlug={workspaceSlug}
              productSlug={productSlug}
              postId={post.id}
            />
            <Button
              type="button"
              variant={voted ? "secondary" : "outline"}
              size="sm"
              onClick={handleVote}
              aria-pressed={voted}
              aria-label={`${voted ? "Remove your vote from" : "Vote for"} ${post.title}`}
              className="shrink-0"
            >
              <ArrowBigUp aria-hidden="true" />
              {votes}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
          <Label htmlFor="request-assignee" className="text-[11px]">
            Assignee
          </Label>
          {canWrite ? (
            <Select
              value={post.assigneeId ?? "unassigned"}
              onValueChange={assignAssignee}
              disabled={assigneeBusy}
            >
              <SelectTrigger
                id="request-assignee"
                size="sm"
                className="h-7 w-44 bg-background"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {state.teamMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">
              {post.assigneeName ?? "Unassigned"}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {post.assigneeId === state.currentUser.id
              ? "This request is yours."
              : "Assignment does not change status or visibility."}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
          <Label htmlFor="request-planned-for" className="text-[11px]">
            Planned for
          </Label>
          <Input
            id="request-planned-for"
            value={plannedFor}
            placeholder="2027-Q1 or 2027-03-31"
            maxLength={32}
            className="h-7 w-44 bg-background text-xs"
            onChange={(event) => setPlannedForValue(event.target.value)}
            disabled={!canWrite || plannedBusy}
          />
          {canWrite && plannedFor !== (post.plannedFor ?? "") ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={savePlannedFor}
              disabled={plannedBusy}
            >
              {plannedBusy ? "Saving…" : "Save"}
            </Button>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {post.plannedFor
              ? `Internal target: ${plannedForLabel(post.plannedFor)}. Public only when the workspace policy allows it.`
              : "No target set. Public only when the workspace policy allows it."}
          </span>
        </div>

        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {post.description}
        </p>

        {post.originalTitle || post.originalBody ? (
          <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Original wording before the AI rewrite
            </summary>
            {post.originalTitle ? (
              <p className="mt-2 font-medium text-foreground">{post.originalTitle}</p>
            ) : null}
            {post.originalBody ? (
              <p className="mt-1 whitespace-pre-line text-muted-foreground">
                {post.originalBody}
              </p>
            ) : null}
          </details>
        ) : null}

        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <BookOpen className="size-3" aria-hidden="true" />
              Evidence
            </p>
            <p className="text-[11px] text-muted-foreground">
              {demand.customers} {demand.customers === 1 ? "customer" : "customers"}{" "}
              asked for this, from {demand.sources}{" "}
              {demand.sources === 1 ? "source" : "sources"}
            </p>
          </div>

          {insights.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No evidence yet. Add the customer&apos;s own words from a call, an email or a
              support thread.
            </p>
          ) : (
            <ul className="grid gap-2">
              {insights.map((insight) => (
                <li key={insight.id} className="rounded-md border bg-background p-2">
                  <blockquote className="whitespace-pre-line text-xs leading-relaxed text-foreground">
                    “{insight.quote}”
                  </blockquote>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{INSIGHT_SOURCE_LABELS[insight.source]}</span>
                    {insight.authorLabel ? <span>· {insight.authorLabel}</span> : null}
                    <span>· {formatDate(insight.occurredAt, timeZone)}</span>
                    {canWrite ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-6"
                        aria-label="Remove this evidence"
                        disabled={insightBusy}
                        onClick={() => removeInsight(insight.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <div className="grid gap-2 border-t pt-2">
              <Label htmlFor="insight-quote" className="text-[11px]">
                What the customer said
              </Label>
              <Textarea
                id="insight-quote"
                value={insightQuote}
                rows={2}
                maxLength={2000}
                placeholder="We would pay for SSO today…"
                onChange={(event) => setInsightQuote(event.target.value)}
                disabled={insightBusy}
                aria-invalid={Boolean(insightError)}
                aria-describedby={insightError ? "insight-error" : undefined}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="insight-source" className="text-[11px]">
                    Source
                  </Label>
                  <Select
                    value={insightSource}
                    onValueChange={(value) => setInsightSource(value as InsightSource)}
                    disabled={insightBusy}
                  >
                    <SelectTrigger id="insight-source" size="sm" className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(INSIGHT_SOURCE_LABELS) as InsightSource[]).map((source) => (
                        <SelectItem key={source} value={source}>
                          {INSIGHT_SOURCE_LABELS[source]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="insight-author" className="text-[11px]">
                    Who said it
                  </Label>
                  <Input
                    id="insight-author"
                    value={insightAuthor}
                    maxLength={160}
                    placeholder="Name or company"
                    onChange={(event) => setInsightAuthor(event.target.value)}
                    disabled={insightBusy}
                  />
                </div>
              </div>
              {insightError ? (
                <p id="insight-error" role="alert" className="text-xs font-medium text-destructive">
                  {insightError}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={saveInsight}
                disabled={insightBusy || insightQuote.trim().length < 3}
              >
                <Plus aria-hidden="true" />
                {insightBusy ? "Saving…" : "Add evidence"}
              </Button>
            </div>
          ) : null}

          <div className="space-y-2 border-t pt-2">
            <p className="text-xs font-medium">Context</p>
            {contextLinks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No help article or changelog entry attached.
              </p>
            ) : (
              <ul className="grid min-w-0 grid-cols-1 gap-1">
                {contextLinks.map((link) => (
                  <li
                    key={link.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-2 py-1"
                  >
                    <Link
                      href={
                        link.kind === "help_article"
                          ? `/app/${workspaceSlug}/${productSlug}/help/${link.refId}`
                          : `/app/${workspaceSlug}/${productSlug}/releases/${link.refId}/edit`
                      }
                      className="min-w-0 truncate text-xs hover:underline"
                    >
                      {link.kind === "help_article" ? "Help" : "Changelog"} ·{" "}
                      {link.label ?? "Unavailable"}
                    </Link>
                    {canWrite ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0"
                        aria-label="Remove this context"
                        disabled={contextBusy}
                        onClick={() => detachContext(link.id)}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canWrite ? (
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={contextKind}
                    onValueChange={(value) => {
                      setContextKind(value as "help_article" | "changelog");
                      setContextRefId("");
                    }}
                    disabled={contextBusy}
                  >
                    <SelectTrigger size="sm" className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="help_article">Help article</SelectItem>
                      <SelectItem value="changelog">Changelog entry</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={contextRefId}
                    onValueChange={setContextRefId}
                    disabled={contextBusy || contextOptions.length === 0}
                  >
                    <SelectTrigger size="sm" className="bg-background">
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {contextOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={attachContext}
                  disabled={contextBusy || contextRefId === ""}
                >
                  <Link2 aria-hidden="true" />
                  {contextBusy ? "Attaching…" : "Attach context"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Reference material for the team. Context never counts as demand.
                </p>
              </div>
            ) : null}
          </div>

          {mergeSuggestions.length > 0 ? (
            <div className="space-y-2 border-t pt-2">
              <p className="text-xs font-medium">Possible duplicates</p>
              <ul className="grid min-w-0 grid-cols-1 gap-1">
                {mergeSuggestions.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-2 py-1"
                  >
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-xs hover:underline"
                      onClick={() => onSelectPost(candidate.id)}
                    >
                      {candidate.title}
                    </button>
                    {canWrite ? (
                      <ConfirmDialog
                        trigger={
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 shrink-0 px-2 text-[11px]"
                            disabled={tagBusy}
                          >
                            Merge
                          </Button>
                        }
                        title={`Merge “${post.title}” into “${candidate.title}”?`}
                        description="This closes the current request and moves its comments, votes, tags and evidence to the chosen request. The merge can be undone from the target."
                        confirmLabel="Merge requests"
                        onConfirm={() => mergeInto(candidate.id)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Ranked by shared title and body words. Duplicate triage holds the full queue.
              </p>
            </div>
          ) : null}
        </div>

        <FeedbackIntegrationPanel
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          postId={post.id}
          canWrite={canWrite}
        />

        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">Prioritisation</p>
            <PrioritisationSignals
              signals={getPrioritySignals(state, post.id)}
              votes={votes}
              showVotes
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "priority-impact", label: "Impact", value: impact, set: setImpact },
              {
                id: "priority-value",
                label: "Business value",
                value: businessValue,
                set: setBusinessValue,
              },
              { id: "priority-effort", label: "Effort", value: effort, set: setEffort },
            ].map((input) => (
              <div key={input.id} className="space-y-1">
                <Label htmlFor={input.id} className="text-[11px]">
                  {input.label}
                </Label>
                <select
                  id={input.id}
                  value={input.value}
                  disabled={!canWrite || priorityBusy}
                  aria-invalid={Boolean(priorityError)}
                  aria-describedby={priorityError ? "priority-error" : undefined}
                  onChange={(event) => input.set(event.target.value)}
                  className={FIELD_FILTER_CLASS}
                >
                  <option value="">Not set</option>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <option key={score} value={score}>
                      {score}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Priority score = impact ÷ effort × demand, where demand is requester weight
            (distinct customers, plus one per ${"$"}
            {formatNumber(REVENUE_WEIGHT_UNIT)} of known annual revenue or open CRM deal
            value, at least 1). Value ÷ effort uses business value and effort. Missing inputs
            show “—”, never zero.
          </p>
          {priorityError ? (
            <p id="priority-error" role="alert" className="text-xs font-medium text-destructive">
              {priorityError}
            </p>
          ) : null}
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={savePriority}
              disabled={priorityBusy}
            >
              {priorityBusy ? "Saving…" : "Save signals"}
            </Button>
          ) : null}
        </div>

        {productFields.length > 0 ? (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium">Custom fields</p>
            <CustomFieldInputs
              fields={productFields}
              values={fieldValues}
              onChange={(key, value) =>
                setFieldValues((current) => ({ ...current, [key]: value }))
              }
              idPrefix="feedback-field"
              disabled={!canWrite || fieldBusy}
            />
            {fieldError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {fieldError}
              </p>
            ) : null}
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={saveCustomFields}
                disabled={fieldBusy}
              >
                {fieldBusy ? "Saving…" : "Save custom fields"}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
          {canWrite ? (
            <OnBehalfDialog
              workspaceSlug={workspaceSlug}
              productSlug={productSlug}
              mode="vote"
              postId={post.id}
            />
          ) : null}
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="feedback-status" className="text-xs">
              Status
            </Label>
            <Select
              value={post.status}
              onValueChange={handleStatus}
              disabled={!canWrite || Boolean(post.mergedIntoId)}
            >
              <SelectTrigger id="feedback-status" size="sm" className="min-w-0 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.filter((option) => option !== "all").map((option) => (
                  <SelectItem key={option} value={option}>
                    {FEEDBACK_STATUS_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Planned, In progress and Shipped move this request on the public roadmap.
            </p>
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="feedback-release" className="flex items-center gap-1.5 text-xs">
              <Link2 className="size-3" aria-hidden="true" />
              Release
            </Label>
            <Select
              value={post.releaseId ?? "none"}
              onValueChange={handleReleaseLink}
              disabled={!canWrite || Boolean(post.mergedIntoId)}
            >
              <SelectTrigger id="feedback-release" size="sm" className="min-w-0 bg-background">
                <SelectValue placeholder="Not linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {releases.map((release) => (
                  <SelectItem key={release.id} value={release.id}>
                    {release.title} · {release.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkedRelease ? (
              <p className="text-[11px] text-muted-foreground">
                Linked to “{linkedRelease.title}” ({linkedRelease.status}).
              </p>
            ) : null}
          </div>

          {!post.mergedIntoId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={() => setMergeOpen(true)}
              disabled={!canWrite}
            >
              <Merge aria-hidden="true" />
              Merge duplicate…
            </Button>
          ) : null}

          {!post.hiddenAt && canModerate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={toggleHidden}
              disabled={visibilityBusy}
            >
              <EyeOff aria-hidden="true" />
              {visibilityBusy ? "Hiding…" : "Hide request"}
            </Button>
          ) : null}

          {canModerate && post.authorCustomerId ? (
            post.authorBanned ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={toggleAuthorBan}
                disabled={banBusy}
              >
                <UserCheck aria-hidden="true" />
                {banBusy ? "Updating…" : "Unban author"}
              </Button>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    disabled={banBusy}
                  >
                    <Ban aria-hidden="true" />
                    {banBusy ? "Updating…" : "Ban author"}
                  </Button>
                }
                title="Ban this customer?"
                description="They are signed out everywhere and their requests and comments are hidden from public pages. You can unban them from here later."
                confirmLabel="Ban customer"
                onConfirm={toggleAuthorBan}
              >
                <p className="text-sm text-muted-foreground">{post.authorName}</p>
              </ConfirmDialog>
            )
          ) : null}

          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <Tag className="size-3" aria-hidden="true" />
              Tags
            </Label>
            {postTags.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No tags yet. Tags help customers filter this board.
              </p>
            ) : (
              <ul className="grid gap-1">
                {postTags.map((tag) => (
                  <li
                    key={tag.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1"
                  >
                    <span className="truncate text-xs">{tag.name}</span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        aria-label={`Remove ${tag.name} from this request`}
                        onClick={() => removeTag(tag.id)}
                        disabled={!canWrite || tagBusy}
                      >
                        <X aria-hidden="true" />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-6 text-muted-foreground"
                            aria-label={`Delete the ${tag.name} tag from this board`}
                            disabled={!canWrite || tagBusy}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        }
                        title={`Delete the “${tag.name}” tag?`}
                        description="It is removed from this board and from every request that carries it. This cannot be undone."
                        confirmLabel="Delete tag"
                        onConfirm={() => deleteTag(tag.id)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canWrite && availableTags.length > 0 ? (
              <Select value={tagChoice} onValueChange={addTag} disabled={tagBusy}>
                <SelectTrigger size="sm" className="bg-background">
                  <SelectValue placeholder="Add an existing tag" />
                </SelectTrigger>
                <SelectContent>
                  {availableTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {canWrite ? (
              <div className="flex gap-1.5">
                <Label htmlFor="new-tag-name" className="sr-only">
                  New tag name
                </Label>
                <Input
                  id="new-tag-name"
                  value={newTagName}
                  maxLength={32}
                  placeholder="New tag…"
                  onChange={(event) => setNewTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      createTag();
                    }
                  }}
                  disabled={tagBusy || !post.boardId}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={createTag}
                  disabled={tagBusy || !post.boardId}
                >
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              </div>
            ) : null}
            {!post.boardId ? (
              <p className="text-[11px] text-muted-foreground">
                Assign this request to a board before tagging it.
              </p>
            ) : null}
          </div>
        </div>

        <section aria-labelledby="public-comments-heading">
          <h3 id="public-comments-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Public comments ({publicComments.length})
          </h3>
          {publicComments.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No public comments yet. Only public replies appear on the customer-facing request.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {publicComments.map((comment) => (
                <li key={comment.id} className="rounded-md border bg-card p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-medium">{comment.authorName}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelative(comment.createdAt, relativeNow)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {comment.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="internal-notes-heading">
          <h3
            id="internal-notes-heading"
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-warning"
          >
            <Lock className="size-3" aria-hidden="true" />
            Internal notes ({internalNotes.length})
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Team only. These never appear on public feedback surfaces.
          </p>
          {internalNotes.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No internal notes.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {internalNotes.map((comment) => (
                <li key={comment.id} className="rounded-md border border-warning/30 bg-warning-muted/60 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-medium text-warning">{comment.authorName}</span>
                    <span className="text-[10px] text-warning/80">
                      {formatRelative(comment.createdAt, relativeNow)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-foreground/80">
                    {comment.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={handleCommentSubmit} className="space-y-2 border-t pt-4">
          {canWrite ? (
            <Tabs
              value={commentMode}
              onValueChange={(value) => setCommentMode(value as typeof commentMode)}
            >
              <TabsList className="h-8">
                <TabsTrigger type="button" value="public" className="text-xs">
                  Public reply
                </TabsTrigger>
                <TabsTrigger type="button" value="internal" className="text-xs">
                  Internal note
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">Public reply</p>
          )}
          <Label htmlFor="feedback-comment" className="sr-only">
            {commentMode === "internal" ? "Internal note" : "Public comment"}
          </Label>
          <Textarea
            id="feedback-comment"
            value={commentBody}
            onChange={(event) => {
              setCommentBody(event.target.value);
              setCommentError(null);
            }}
            rows={3}
            placeholder={
              commentMode === "internal"
                ? "Add context for the team. This is never shown publicly."
                : "Write a public reply to the customer."
            }
            aria-invalid={commentError ? true : undefined}
            aria-describedby={commentError ? "feedback-comment-error" : undefined}
          />
          {commentError ? (
            <p id="feedback-comment-error" role="alert" className="text-xs font-medium text-destructive">
              {commentError}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {commentMode === "internal"
                ? "Internal notes are marked and styled separately everywhere."
                : "Visible to customers on the public feedback request."}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            variant={commentMode === "internal" ? "secondary" : "default"}
            disabled={!canComment}
          >
            <Plus aria-hidden="true" />
            {commentMode === "internal" ? "Add internal note" : "Add comment"}
          </Button>
        </form>
      </CardContent>

      <MergeFeedbackDialog
        key={`merge-${post.id}-${mergeOpen ? "open" : "closed"}`}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        source={post}
        candidates={mergedTargets}
        onMerged={(targetId) => {
          setMergeOpen(false);
          onSelectPost(targetId);
        }}
      />
    </Card>
  );
}

function MergeFeedbackDialog({
  open,
  onOpenChange,
  workspaceSlug,
  productSlug,
  source,
  candidates,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  productSlug: string;
  source: FeedbackPost;
  candidates: FeedbackPost[];
  onMerged: (targetId: string) => void;
}) {
  const router = useRouter();
  const { state } = useDashboard();
  const [targetId, setTargetId] = useState<string>("");
  const [stage, setStage] = useState<"select" | "confirm">("select");
  const target = candidates.find((candidate) => candidate.id === targetId) ?? null;

  async function handleMerge() {
    if (!target) return;
    const result = await mergeFeedbackAction({
      workspaceSlug,
      productSlug,
      postId: source.id,
      targetId: target.id,
    });
    if (!result.ok) {
      toast.error("Could not merge requests", { description: result.error });
      return;
    }
    toast.success("Requests merged", {
      description: `Comments, votes, reactions and tags moved to “${target.title}”. The original stays closed for audit.`,
    });
    onMerged(target.id);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stage === "select" ? "Merge into another request" : "Confirm merge"}</DialogTitle>
          <DialogDescription>
            {stage === "select"
              ? "Choose the request this one duplicates. This closes the current request."
              : "Review the effect before merging. The merge is written to the database."}
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <EmptyState
            compact
            icon={Merge}
            title="No merge target"
            description="There are no other unmerged requests in this product."
          />
        ) : stage === "select" ? (
          <div className="space-y-2">
            <Label htmlFor="merge-target" className="text-xs">
              Target request
            </Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger id="merge-target">
                <SelectValue placeholder="Choose a request" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.title} ({getVoteCount(state, candidate.id)} votes)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              “{source.title}” will be marked closed and linked to the target. Its comments, votes,
              reactions, tags and attachments move to the canonical request; duplicates that already
              exist there are not counted twice.
            </p>
          </div>
        ) : target ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{source.title}</span>
                <span className="text-xs text-muted-foreground">
                  {getVoteCount(state, source.id)} votes
                </span>
              </div>
              <p className="my-2 text-center text-xs text-muted-foreground">merges into</p>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{target.title}</span>
                <span className="text-xs text-muted-foreground">
                  {getVoteCount(state, target.id)} votes
                </span>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The source request becomes closed and its comments, votes, reactions, tags and
              attachments move to the target. You can undo the merge from this request afterwards.
              {" "}
              The merge is saved to the database; no activity feed is connected yet.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {stage === "select" ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!targetId}
                onClick={() => setStage("confirm")}
              >
                Review merge
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStage("select")}>
                Back
              </Button>
              <Button type="button" variant="destructive" onClick={handleMerge}>
                Merge request
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
