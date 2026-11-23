"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  CalendarClock,
  Eye,
  Globe2,
  History,
  ImagePlus,
  Languages,
  Mail,
  MessageSquare,
  Puzzle,
  Save,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { DualTimestamp, ViewerTimeZone } from "@/components/shared/dual-timestamp";
import {
  usePageShortcuts,
  type KeyboardShortcut,
} from "@/components/shared/keyboard-shortcuts";
import { Markdown } from "@/components/shared/markdown";
import { PageHeader } from "@/components/shared/page-header";
import { ReleaseCover } from "@/components/shared/release-cover";
import {
  FeedbackStatusBadge,
  ReleaseStatusBadge,
} from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getActiveSubscriberCount,
  getCancellationReasons,
  getFeedbackForProduct,
  getRouteContext,
  getVoteCount,
  type RouteContext,
} from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { autosaveReleaseAction, saveReleaseAction } from "@/features/releases/actions";
import { formatDateTime, isoToZonedInput, now, timeZoneAbbreviation, zonedInputToIso } from "@/lib/format";
import { AudiencePreviewDialog } from "@/features/releases/audience-preview-dialog";
import { ReleaseHistoryDialog } from "@/features/releases/release-history-dialog";
import {
  snapshotFromRelease,
  type ReleaseRevisionSnapshot,
} from "@/features/releases/revision-types";
import {
  inlineImageAlt,
  inlineImageMarkdownWithAlt,
  insertMarkdownBlock,
} from "@/features/releases/inline-images";
import {
  InlineImageAltDialog,
  type PendingInlineImage,
} from "@/features/releases/inline-image-alt-dialog";
import {
  buildReleaseTemplate,
  RELEASE_TEMPLATE_SUMMARIES,
  type ReleaseTemplateId,
} from "@/features/releases/templates";
import { hasPermission } from "@/lib/permissions";
import { slugify } from "@/lib/slug";
import type { Release, ReleaseCover as ReleaseCoverValue } from "@/types";

import {
  releaseFormSchema,
  type ReleaseFormValues,
} from "./release-schema";
import { normalizeReleaseTags, parseReleaseTagText } from "./tags";
import { AiDraftDialog } from "./ai-draft-dialog";
import type { AiDraftRewriteOutput } from "./action-types";
import { PublishReviewDialog } from "./publish-review-dialog";
import { ReleasePreviewDialog } from "./release-preview-dialog";

const PRESET_COVERS: { value: "grid" | "orbit" | "waves" | "plain"; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "orbit", label: "Orbit" },
  { value: "waves", label: "Waves" },
  { value: "plain", label: "Solid" },
];

const RELEASE_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "Ctrl/⌘ S", action: "Save the draft" },
  { keys: "Ctrl/⌘ Enter", action: "Open the publish or schedule review" },
];

const MAX_COVER_BYTES = 1_500_000;
const COVER_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SOCIAL_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type SaveDestination = "draft" | "publish" | "schedule";

export function ReleaseEditor({
  workspaceSlug,
  productSlug,
  releaseId,
}: {
  workspaceSlug: string;
  productSlug: string;
  releaseId?: string;
}) {
  const { state } = useDashboard();
  const context = getRouteContext(state, workspaceSlug, productSlug);
  const existing = releaseId
    ? state.releases.find((release) => release.id === releaseId) ?? null
    : null;

  if (!context) {
    return (
      <EmptyState
        title="Product not found"
        description="This workspace or product is not available to your account."
      />
    );
  }

  if (releaseId && !existing) {
    return (
      <EmptyState
        title="Release not found"
        description="This release does not exist in this product, or you no longer have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${workspaceSlug}/${productSlug}/releases`}>Back to releases</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ReleaseEditorForm
      key={existing?.id ?? "new-release"}
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      existing={existing}
      context={context}
    />
  );
}

function ReleaseEditorForm({
  workspaceSlug,
  productSlug,
  existing,
  context,
}: {
  workspaceSlug: string;
  productSlug: string;
  existing: Release | null;
  context: RouteContext;
}) {
  const router = useRouter();
  const { state } = useDashboard();
  usePageShortcuts(RELEASE_SHORTCUTS);
  const { product, workspace, role } = context;
  const base = `/app/${workspaceSlug}/${productSlug}`;
  const timeZone = workspace.timezone;
  const tz = timeZoneAbbreviation(timeZone);
  const isArchived = existing?.status === "archived";
  const isPublished = existing?.status === "published";

  const [slugTouched, setSlugTouched] = useState(Boolean(existing));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<ReleaseFormValues | null>(null);
  const [pendingMode, setPendingMode] = useState<"publish" | "schedule" | "update">("publish");
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [coverUploading, setCoverUploading] = useState(false);
  const [socialImageUploading, setSocialImageUploading] = useState(false);
  const [inlineImageUploading, setInlineImageUploading] = useState(false);
  const [pendingInlineImages, setPendingInlineImages] = useState<PendingInlineImage[]>([]);
  const [aiRewriteOpen, setAiRewriteOpen] = useState(false);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyImageInputRef = useRef<HTMLInputElement | null>(null);
  const inlineUploadInFlightRef = useRef(false);
  const autosaveSnapshotRef = useRef<string | null>(null);
  const autosavedIdRef = useRef<string | null>(existing?.id ?? null);
  const releaseActionRef = useRef<{ save: () => void; review: () => void }>({
    save: () => {},
    review: () => {},
  });

  const defaultValues: ReleaseFormValues = {
    title: existing?.title ?? "",
    slug: existing?.slug ?? "",
    summary: existing?.summary ?? "",
    body: existing?.body ?? "",
    translations: existing?.translations ?? {},
    category: existing?.category ?? "feature",
    tagsText: existing?.tags.join(", ") ?? "",
    authorIds:
      existing?.authors && existing.authors.length > 0
        ? existing.authors.map((author) => author.id)
        : [state.currentUser.id],
    youtubeUrl: existing?.youtubeUrl ?? "",
    cover: existing?.cover ?? { kind: "preset", preset: "grid" },
    ogImage: existing?.ogImage ?? null,
    channels: existing?.channels ?? {
      publicChangelog: true,
      inAppWidget: true,
      subscriberEmail: true,
    },
    linkedFeedbackIds: existing?.linkedFeedbackIds ?? [],
    linkedCancellationReasonIds: existing?.linkedCancellationReasonIds ?? [],
    publishMode: existing?.status === "scheduled" ? "schedule" : "now",
    scheduledFor: isoToZonedInput(existing?.scheduledFor ?? null, timeZone),
  };

  const form = useForm<ReleaseFormValues>({
    resolver: zodResolver(releaseFormSchema),
    defaultValues,
    mode: "onSubmit",
  });

  const values = useWatch({ control: form.control }) as ReleaseFormValues;
  const title = values.title ?? "";
  const publishMode = values.publishMode ?? "now";
  const cover = (values.cover ?? { kind: "preset", preset: "grid" }) as ReleaseCoverValue;

  const feedback = getFeedbackForProduct(state, product.id).filter(
    (post) => post.mergedIntoId === null,
  );
  const authorOptions =
    state.teamMembers.length > 0
      ? state.teamMembers
      : [
          {
            id: state.currentUser.id,
            name: state.currentUser.name,
            email: state.currentUser.email,
            role,
          },
        ];
  const reasons = getCancellationReasons(state, product.id);
  const activeSubscribers = getActiveSubscriberCount(state, product.id);
  const releaseTagSlugs = normalizeReleaseTags(parseReleaseTagText(values.tagsText ?? "")).map(
    (tag) => tag.slug,
  );

  const canWrite = hasPermission(role, "release:write");
  const canManageWinback = hasPermission(role, "winback:manage");
  const savingRef = useRef(false);

  useEffect(() => {
    if (!canWrite || isArchived || savingRef.current || reviewOpen) return;

    const payload = {
      workspaceSlug,
      productSlug,
      releaseId: autosavedIdRef.current ?? existing?.id ?? undefined,
      title: values.title ?? "",
      slug: values.slug ?? "",
      summary: values.summary ?? "",
      body: values.body ?? "",
      translations: values.translations ?? {},
      category: values.category ?? "feature",
      tagsText: values.tagsText ?? "",
      authorIds: values.authorIds ?? [],
      youtubeUrl: values.youtubeUrl ?? "",
      cover: values.cover ?? { kind: "preset" as const, preset: "grid" as const },
      ogImageKey: values.ogImage?.key ?? null,
      channels: values.channels ?? {
        publicChangelog: true,
        inAppWidget: false,
        subscriberEmail: false,
      },
      linkedFeedbackIds: values.linkedFeedbackIds ?? [],
      linkedCancellationReasonIds: values.linkedCancellationReasonIds ?? [],
    };
    const snapshot = JSON.stringify(payload);

    // The first render records the baseline; only later edits autosave.
    if (autosaveSnapshotRef.current === null) {
      autosaveSnapshotRef.current = snapshot;
      return;
    }
    if (snapshot === autosaveSnapshotRef.current) return;
    if (
      payload.title.trim().length === 0 ||
      payload.slug.trim().length === 0 ||
      payload.authorIds.length === 0
    ) {
      return;
    }
    if (!existing && payload.title.trim().length < 3) return;

    const timer = setTimeout(() => {
      autosaveSnapshotRef.current = snapshot;
      setAutosaveState("saving");
      void autosaveReleaseAction(payload).then((result) => {
        if (!result.ok) {
          setAutosaveState("error");
          return;
        }
        setAutosaveState("saved");
        if (!autosavedIdRef.current) {
          autosavedIdRef.current = result.data.releaseId;
          router.replace(`${base}/releases/${result.data.releaseId}/edit`);
        }
      });
    }, 1400);

    return () => clearTimeout(timer);
  }, [
    values,
    canWrite,
    isArchived,
    reviewOpen,
    existing,
    workspaceSlug,
    productSlug,
    router,
    base,
  ]);

  function toggleArrayValue(
    field: "linkedFeedbackIds" | "linkedCancellationReasonIds",
    id: string,
    checked: boolean,
  ) {
    const current = form.getValues(field);
    form.setValue(
      field,
      checked ? [...current, id] : current.filter((value) => value !== id),
      { shouldDirty: true },
    );
  }

  async function persist(formValues: ReleaseFormValues, destination: SaveDestination) {
    if (!canWrite) {
      toast.error("Your role cannot edit releases.");
      return false;
    }

    let scheduledFor: string | null = null;
    if (destination === "schedule") {
      scheduledFor = zonedInputToIso(formValues.scheduledFor, timeZone);
      if (!scheduledFor) {
        form.setError("scheduledFor", { message: "Choose a date and time to schedule." });
        toast.error("Choose a valid schedule date and time.");
        return false;
      }
      if (new Date(scheduledFor).getTime() <= now().getTime()) {
        form.setError("scheduledFor", { message: "The schedule must be in the future." });
        toast.error("The schedule must be in the future.");
        return false;
      }
    }

    const linkedCancellationReasonIds = canManageWinback
      ? formValues.linkedCancellationReasonIds
      : existing?.linkedCancellationReasonIds ?? [];

    savingRef.current = true;
    let result: Awaited<ReturnType<typeof saveReleaseAction>>;
    try {
      result = await saveReleaseAction({
        workspaceSlug,
        productSlug,
        releaseId: autosavedIdRef.current ?? existing?.id,
        title: formValues.title,
        slug: formValues.slug,
        summary: formValues.summary,
        body: formValues.body,
        translations: formValues.translations ?? {},
        category: formValues.category,
        tagsText: formValues.tagsText,
        authorIds: formValues.authorIds,
        youtubeUrl: formValues.youtubeUrl,
        cover: formValues.cover,
        ogImageKey: formValues.ogImage?.key ?? null,
        channels: formValues.channels,
        linkedFeedbackIds: formValues.linkedFeedbackIds,
        linkedCancellationReasonIds,
        destination,
        scheduledFor,
      });
    } finally {
      savingRef.current = false;
    }

    if (!result.ok) {
      for (const field of [
        "title",
        "slug",
        "summary",
        "body",
        "category",
        "tagsText",
        "authorIds",
        "youtubeUrl",
        "cover",
        "ogImage",
        "channels",
        "linkedFeedbackIds",
        "linkedCancellationReasonIds",
        "scheduledFor",
      ] as const) {
        const message = result.fieldErrors?.[field]?.[0];
        if (message) form.setError(field, { message });
      }
      toast.error("Could not save the release", { description: result.error });
      return false;
    }

    const savedId = result.data.releaseId;
    if (destination === "draft") {
      if (!existing) {
        router.replace(`${base}/releases/${savedId}/edit`);
      } else {
        router.refresh();
      }
    } else if (destination === "schedule") {
      toast.success("Release scheduled", {
        description: `${formValues.title} is scheduled for ${formatDateTime(scheduledFor, timeZone)}. No email or win-back campaign was sent.`,
      });
      router.push(`${base}/releases`);
    } else {
      toast.success(isPublished ? "Published release updated" : "Release published", {
        description:
          formValues.channels.subscriberEmail && !isPublished
            ? "Pending subscriber deliveries were recorded; no email provider is connected. No win-back campaign was sent."
            : "No win-back campaign was sent.",
      });
      router.push(`${base}/releases`);
    }
    return true;
  }

  async function handleSaveDraft() {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Check the highlighted fields before saving.");
      return;
    }
    await persist(form.getValues(), "draft");
  }

  async function handleReviewPublish() {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Check the highlighted fields before publishing.");
      return;
    }

    const formValues = form.getValues();
    const mode: "publish" | "schedule" | "update" = isPublished
      ? "update"
      : formValues.publishMode === "schedule"
        ? "schedule"
        : "publish";

    if (mode === "schedule") {
      if (!formValues.scheduledFor) {
        form.setError("scheduledFor", { message: "Choose a date and time to schedule." });
        toast.error("Choose a date and time to schedule.");
        return;
      }
      const scheduledIso = zonedInputToIso(formValues.scheduledFor, timeZone);
      if (!scheduledIso || new Date(scheduledIso).getTime() <= now().getTime()) {
        form.setError("scheduledFor", { message: "The schedule must be in the future." });
        toast.error("The schedule must be in the future.");
        return;
      }
    }

    setPendingValues(formValues);
    setPendingMode(mode);
    setReviewOpen(true);
  }

  // The key handler reads through a ref so it subscribes once while still
  // calling the latest form handlers (and their current form values).
  useEffect(() => {
    releaseActionRef.current = {
      save: () => void handleSaveDraft(),
      review: () => void handleReviewPublish(),
    };
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!isPublished) releaseActionRef.current.save();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        releaseActionRef.current.review();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPublished]);

  async function handleConfirmReview() {
    if (!pendingValues) return;
    const destination =
      pendingMode === "schedule" ? "schedule" : "publish";
    const saved = await persist(pendingValues, destination);
    if (saved) {
      setReviewOpen(false);
      setPendingValues(null);
    }
  }

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    if (!COVER_UPLOAD_TYPES.includes(file.type)) {
      toast.error("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      toast.error("Cover images must be smaller than 1.5 MB.");
      return;
    }

    setCoverUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/releases/cover`,
        { method: "POST", body },
      );
      const payload = (await response.json().catch(() => null)) as {
        key?: string;
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.key || !payload?.url) {
        toast.error(payload?.error ?? "Could not upload that image.");
        return;
      }
      form.setValue(
        "cover",
        { kind: "custom", key: payload.key, url: payload.url },
        { shouldDirty: true, shouldValidate: true },
      );
    } catch {
      toast.error("Could not upload that image.");
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleSocialImageUpload(file: File | null) {
    if (!file) return;
    if (!COVER_UPLOAD_TYPES.includes(file.type)) {
      toast.error("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_SOCIAL_IMAGE_BYTES) {
      toast.error("Social images must be smaller than 5 MB.");
      return;
    }

    setSocialImageUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/releases/social-image`,
        { method: "POST", body },
      );
      const payload = (await response.json().catch(() => null)) as {
        key?: string;
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.key || !payload?.url) {
        toast.error(payload?.error ?? "Could not upload that image.");
        return;
      }
      form.setValue(
        "ogImage",
        { key: payload.key, url: payload.url },
        { shouldDirty: true, shouldValidate: true },
      );
    } catch {
      toast.error("Could not upload that image.");
    } finally {
      setSocialImageUploading(false);
    }
  }

  function insertBodyMarkdown(markdown: string) {
    const textarea = bodyTextareaRef.current;
    const current = form.getValues("body") ?? "";
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? start;
    const next = insertMarkdownBlock(current, markdown, start, end);

    form.setValue("body", next.value, { shouldDirty: true, shouldValidate: true });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(next.caret, next.caret);
    });
  }

  async function uploadInlineImage(file: File): Promise<PendingInlineImage | null> {
    if (!INLINE_IMAGE_TYPES.includes(file.type)) {
      toast.error("Choose a PNG, JPEG, WebP or GIF image.");
      return null;
    }
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      toast.error("Inline images must be smaller than 5 MB.");
      return null;
    }

    const body = new FormData();
    body.append("file", file);
    const response = await fetch(
      `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/releases/images`,
      { method: "POST", body },
    );
    const payload = (await response.json().catch(() => null)) as {
      key?: string;
      url?: string;
      error?: string;
    } | null;
    if (!response.ok || !payload?.key || !payload?.url) {
      toast.error(payload?.error ?? "Could not upload that image.");
      return null;
    }
    return {
      key: payload.key,
      url: payload.url,
      fileName: file.name || "Release image",
      defaultAlt: inlineImageAlt(file.name || "Release image"),
    };
  }

  async function insertInlineImages(files: File[]) {
    if (files.length === 0 || inlineUploadInFlightRef.current) return;

    inlineUploadInFlightRef.current = true;
    setInlineImageUploading(true);
    try {
      const uploaded: PendingInlineImage[] = [];
      for (const file of files) {
        const image = await uploadInlineImage(file);
        if (image) uploaded.push(image);
      }
      if (uploaded.length > 0) setPendingInlineImages(uploaded);
    } catch {
      toast.error("Could not upload that image.");
    } finally {
      inlineUploadInFlightRef.current = false;
      setInlineImageUploading(false);
    }
  }

  function confirmInlineImages(entries: Array<PendingInlineImage & { alt: string }>) {
    insertBodyMarkdown(
      entries
        .map((entry) => inlineImageMarkdownWithAlt(entry.key, entry.alt))
        .join("\n\n"),
    );
    setPendingInlineImages([]);
  }

  function handleBodyPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;

    event.preventDefault();
    void insertInlineImages(files);
  }

  function handleBodyImageInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void insertInlineImages(files);
  }

  function applyTemplate(id: ReleaseTemplateId) {
    const template = buildReleaseTemplate(id, {
      productName: product.name,
      date: now(),
    });
    form.setValue("title", template.title, { shouldDirty: true, shouldValidate: true });
    form.setValue("summary", template.summary, { shouldDirty: true, shouldValidate: true });
    form.setValue("body", template.body, { shouldDirty: true, shouldValidate: true });
    form.setValue("category", template.category, { shouldDirty: true });
    form.setValue("tagsText", template.tags.join(", "), { shouldDirty: true });
    if (!slugTouched) {
      form.setValue("slug", slugify(template.title), { shouldValidate: false });
    }
  }

  function applyAiRewrite(draft: AiDraftRewriteOutput) {
    form.reset({
      ...form.getValues(),
      title: draft.title,
      summary: draft.summary,
      body: draft.body,
      category: draft.category,
      tagsText: draft.tags.join(", "),
    });
    // The server already saved this copy; treat it as the new autosave baseline
    // so an unchanged form does not immediately write it again.
    autosaveSnapshotRef.current = null;
  }

  function applyRestoredRevision(snapshot: ReleaseRevisionSnapshot) {
    const currentCover = form.getValues("cover");
    const currentSocial = form.getValues("ogImage");
    form.reset({
      ...form.getValues(),
      title: snapshot.title,
      slug: snapshot.slug,
      summary: snapshot.summary,
      body: snapshot.body,
      translations: snapshot.translations,
      category: snapshot.category,
      cover: snapshot.cover.kind === "custom" ? currentCover : snapshot.cover,
      ogImage: snapshot.ogImageKey
        ? {
            key: snapshot.ogImageKey,
            url: currentSocial?.key === snapshot.ogImageKey ? currentSocial.url : null,
          }
        : null,
      youtubeUrl: snapshot.youtubeUrl ?? "",
      channels: snapshot.channels,
      tagsText: snapshot.tags.join(", "),
      authorIds: snapshot.authorIds,
      linkedFeedbackIds: snapshot.linkedFeedbackIds,
      linkedCancellationReasonIds: snapshot.linkedCancellationReasonIds,
    });
    setSlugTouched(true);
    autosaveSnapshotRef.current = null;
  }

  const previewRelease: Release = {
    id: existing?.id ?? "preview",
    productId: product.id,
    title: values.title?.trim() || "Untitled release",
    slug: values.slug ?? "",
    summary: values.summary ?? "",
    body: values.body ?? "",
    translations: values.translations ?? {},
    category: values.category ?? "feature",
    status: existing?.status ?? "draft",
    cover,
    ogImage: values.ogImage ?? null,
    channels: values.channels ?? {
      publicChangelog: true,
      inAppWidget: false,
      subscriberEmail: false,
    },
    publishedAt: existing?.publishedAt ?? null,
    scheduledFor:
      (values.publishMode === "schedule" && zonedInputToIso(values.scheduledFor ?? "", timeZone)) ||
      existing?.scheduledFor ||
      null,
    createdAt: existing?.createdAt ?? now().toISOString(),
    updatedAt: now().toISOString(),
    authorName:
      state.teamMembers.find((member) => member.id === values.authorIds?.[0])?.name ??
      existing?.authorName ??
      state.currentUser.name,
    authors: (values.authorIds ?? []).flatMap((id) => {
      const member = state.teamMembers.find((candidate) => candidate.id === id);
      return member ? [{ id: member.id, name: member.name }] : [];
    }),
    tags: parseReleaseTagText(values.tagsText ?? ""),
    youtubeUrl: values.youtubeUrl?.trim() || null,
    linkedFeedbackIds: values.linkedFeedbackIds ?? [],
    linkedCancellationReasonIds: values.linkedCancellationReasonIds ?? [],
  };

  // The history diff always compares against the form as it is now, including
  // unsaved edits, so it is a preview of the next save rather than a static log.
  const workingSnapshot = snapshotFromRelease(previewRelease, values.authorIds ?? []);

  if (isArchived && existing) {
    return (
      <div className="space-y-5">
        <PageHeader
          title={existing.title}
          description="This release is archived."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/releases`}>
                <ArrowLeft aria-hidden="true" />
                Back to releases
              </Link>
            </Button>
          }
        />
        <EmptyState
          icon={Undo2}
          title="Archived releases are read-only"
          description="Restore it from the releases list first. Archiving removes a release from public changelog and widget surfaces."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/releases?status=archived`}>Show archived releases</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <PageHeader
        title={existing ? "Edit release" : "New release"}
        description={
          existing
            ? `Editing “${existing.title}”.`
            : `Write a changelog entry for ${product.name}. Drafts are private; publishing affects the selected channels only.`
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href={`${base}/releases`}>
                <ArrowLeft aria-hidden="true" />
                Releases
              </Link>
            </Button>
            {existing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
              >
                <History aria-hidden="true" />
                History
              </Button>
            ) : null}
            {existing?.status === "draft" && canWrite ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAiRewriteOpen(true)}
              >
                <Sparkles aria-hidden="true" />
                Rewrite with AI
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              <Eye aria-hidden="true" />
              Preview
            </Button>
            {!isPublished ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveDraft}
                disabled={form.formState.isSubmitting}
              >
                <Save aria-hidden="true" />
                Save draft
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={handleReviewPublish}>
              <CalendarClock aria-hidden="true" />
              {isPublished
                ? "Update release"
                : publishMode === "schedule"
                  ? "Review schedule"
                  : "Review & publish"}
            </Button>
          </>
        }
        meta={
          <>
            <span aria-live="polite">
              {autosaveState === "saving"
                ? "Autosaving…"
                : autosaveState === "saved"
                  ? "Changes autosaved"
                  : autosaveState === "error"
                    ? "Autosave failed"
                    : "Autosave on"}
            </span>
            <span aria-hidden="true">·</span>
            <span>Timezone: {tz} ({timeZone})</span>
            <span aria-hidden="true">·</span>
            <ViewerTimeZone timeZone={timeZone} />
            {existing?.publishedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Published <DualTimestamp iso={existing.publishedAt} timeZone={timeZone} />
                </span>
              </>
            ) : null}
            {existing?.scheduledFor ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Scheduled <DualTimestamp iso={existing.scheduledFor} timeZone={timeZone} />
                </span>
              </>
            ) : null}
            {existing ? (
              <>
                <span aria-hidden="true">·</span>
                <ReleaseStatusBadge status={existing.status} />
              </>
            ) : null}
            {!canWrite ? <span className="text-warning">Read-only preview role</span> : null}
          </>
        }
      />

      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveDraft();
          }}
          className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"
        >
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Content</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!existing ? (
                  <div className="rounded-md border border-dashed bg-muted/30 p-3">
                    <p className="text-xs font-medium">Start from a template</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      Recurring formats fill the title, summary and body with editable placeholders.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {RELEASE_TEMPLATE_SUMMARIES.map((template) => (
                        <Button
                          key={template.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          title={template.description}
                          onClick={() => applyTemplate(template.id)}
                          disabled={!canWrite}
                        >
                          {template.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(event) => {
                              field.onChange(event.target.value);
                              if (!slugTouched) {
                                form.setValue("slug", slugify(event.target.value), {
                                  shouldValidate: false,
                                });
                              }
                            }}
                            placeholder="What shipped?"
                            disabled={!canWrite}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Slug</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(event) => {
                              setSlugTouched(true);
                              field.onChange(event.target.value);
                            }}
                            placeholder="public-roadmap-pages"
                            disabled={!canWrite}
                          />
                        </FormControl>
                        <FormDescription>Unique within {product.name}. Used in the public URL.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={!canWrite}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="feature">Feature</SelectItem>
                            <SelectItem value="improvement">Improvement</SelectItem>
                            <SelectItem value="fix">Fix</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="summary"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Summary</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={2}
                            maxLength={280}
                            placeholder="One sentence that explains the customer benefit."
                            disabled={!canWrite}
                          />
                        </FormControl>
                        <div className="flex justify-between gap-2">
                          <FormDescription>Shown in the changelog list and widget.</FormDescription>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {field.value.length}/280
                          </span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="youtubeUrl"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel className="flex items-center gap-1.5">
                          <Video className="size-3.5" aria-hidden="true" />
                          YouTube video (optional)
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            placeholder="https://youtu.be/…"
                            inputMode="url"
                            disabled={!canWrite}
                          />
                        </FormControl>
                        <FormDescription>
                          Watch, share, shorts and embed links are accepted. The public page uses a
                          privacy-enhanced player.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="body"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FormLabel>Body</FormLabel>
                        <div className="flex items-center gap-2">
                          <span className="hidden text-[11px] text-muted-foreground sm:inline">
                            Markdown · paste an image to upload it
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => bodyImageInputRef.current?.click()}
                            disabled={!canWrite || inlineImageUploading}
                          >
                            <ImagePlus aria-hidden="true" />
                            {inlineImageUploading ? "Uploading…" : "Insert image"}
                          </Button>
                        </div>
                      </div>
                      <Tabs defaultValue="write" className="w-full">
                        <TabsList className="mb-2 h-8">
                          <TabsTrigger type="button" value="write" className="px-2.5 text-xs">
                            Write
                          </TabsTrigger>
                          <TabsTrigger type="button" value="preview" className="px-2.5 text-xs">
                            Preview
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="write" className="mt-0">
                          <FormControl>
                            <Textarea
                              {...field}
                              ref={(node) => {
                                field.ref(node);
                                bodyTextareaRef.current = node;
                              }}
                              rows={16}
                              placeholder={"### What changed\n\n- …"}
                              className="min-h-80 font-mono text-xs leading-relaxed"
                              disabled={!canWrite}
                              onPaste={handleBodyPaste}
                            />
                          </FormControl>
                          <input
                            ref={bodyImageInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                            className="sr-only"
                            tabIndex={-1}
                            disabled={!canWrite || inlineImageUploading}
                            onChange={handleBodyImageInput}
                          />
                          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                            <span>
                              Headings, lists, links, bold and code are supported. Pasted images are
                              uploaded to storage and inserted as Markdown.
                            </span>
                            <span className="tabular-nums">
                              {field.value.trim() ? field.value.trim().split(/\s+/).length : 0} words
                            </span>
                          </div>
                        </TabsContent>
                        <TabsContent value="preview" className="mt-0">
                          <div className="min-h-80 rounded-md border bg-card p-4">
                            {field.value.trim() ? (
                              <Markdown>{field.value}</Markdown>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                Nothing to preview yet. Write the release body first.
                              </p>
                            )}
                          </div>
                        </TabsContent>
                      </Tabs>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cover"
                  render={() => (
                    <FormItem>
                      <FormLabel>Cover image</FormLabel>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              form.setValue("cover", { kind: "none" }, { shouldDirty: true })
                            }
                            className={
                              cover.kind === "none"
                                ? "flex h-16 w-24 items-center justify-center rounded-md border-2 border-primary bg-muted text-muted-foreground"
                                : "flex h-16 w-24 items-center justify-center rounded-md border bg-muted text-muted-foreground hover:border-primary/50"
                            }
                            aria-pressed={cover.kind === "none"}
                            aria-label="No cover image"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                          {PRESET_COVERS.map((preset) => {
                            const selected =
                              cover.kind === "preset" && cover.preset === preset.value;
                            return (
                              <button
                                key={preset.value}
                                type="button"
                                onClick={() =>
                                  form.setValue(
                                    "cover",
                                    { kind: "preset", preset: preset.value },
                                    { shouldDirty: true },
                                  )
                                }
                                className={
                                  selected
                                    ? "rounded-md border-2 border-primary p-0.5"
                                    : "rounded-md border border-transparent p-0.5 hover:border-border"
                                }
                                aria-pressed={selected}
                                aria-label={`${preset.label} cover`}
                              >
                                <ReleaseCover
                                  cover={{ kind: "preset", preset: preset.value }}
                                  accentColor={product.accentColor}
                                  productInitial={product.name.charAt(0)}
                                  className="h-14 w-20"
                                />
                              </button>
                            );
                          })}
                        </div>
                        <div className="space-y-1">
                          <Button asChild variant="outline" size="sm" className="w-full">
                            <label htmlFor="cover-upload" className="cursor-pointer">
                              <ImagePlus aria-hidden="true" />
                              {coverUploading ? "Uploading…" : "Upload image"}
                              <input
                                id="cover-upload"
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="sr-only"
                                disabled={!canWrite || coverUploading}
                                onChange={(event) => {
                                  void handleCoverUpload(event.target.files?.[0] ?? null);
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          </Button>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            PNG, JPEG or WebP under 1.5 MB. The image is stored privately and
                            served through a signed link.
                          </p>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ogImage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Social share image</FormLabel>
                      <FormDescription>
                        Used as the Open Graph and X card for this entry. Leave it empty to keep
                        the generated card. 1200 × 630 works best.
                      </FormDescription>
                      <div className="flex flex-wrap items-center gap-3">
                        {field.value?.url ? (
                          <ReleaseCover
                            cover={{
                              kind: "custom",
                              key: field.value.key,
                              url: field.value.url,
                            }}
                            accentColor={product.accentColor}
                            productInitial={product.name.charAt(0)}
                            className="h-20 w-32"
                          />
                        ) : (
                          <div className="flex h-20 w-32 items-center justify-center rounded-md border border-dashed bg-muted/40 px-2 text-center text-[10px] leading-tight text-muted-foreground">
                            Generated share card
                          </div>
                        )}
                        <div className="flex flex-col gap-2">
                          <Button asChild variant="outline" size="sm">
                            <label htmlFor="social-image-upload" className="cursor-pointer">
                              <ImagePlus aria-hidden="true" />
                              {socialImageUploading ? "Uploading…" : "Upload image"}
                              <input
                                id="social-image-upload"
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="sr-only"
                                disabled={!canWrite || socialImageUploading}
                                onChange={(event) => {
                                  void handleSocialImageUpload(event.target.files?.[0] ?? null);
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          </Button>
                          {field.value ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                form.setValue("ogImage", null, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                              disabled={!canWrite}
                            >
                              <Trash2 aria-hidden="true" />
                              Use generated card
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Languages className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  Translations
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  One entry, several locales. The canonical title, summary and body stay the
                  default; a translation is used when its fields are complete and content
                  translation is enabled in workspace settings.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Español</p>
                    <span className="text-[11px] text-muted-foreground">
                      {[
                        values.translations?.es?.title,
                        values.translations?.es?.summary,
                        values.translations?.es?.body,
                      ].every((value) => Boolean(value?.trim()))
                        ? "Complete"
                        : "Optional · all three fields needed"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    <FormField
                      control={form.control}
                      name="translations.es.title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Spanish title</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ""}
                              maxLength={120}
                              placeholder="Qué cambió"
                              disabled={!canWrite}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="translations.es.summary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Spanish summary</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              value={field.value ?? ""}
                              rows={2}
                              maxLength={280}
                              placeholder="Una frase que explica el beneficio."
                              disabled={!canWrite}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="translations.es.body"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Spanish body</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              value={field.value ?? ""}
                              rows={8}
                              className="font-mono text-xs leading-relaxed"
                              placeholder={"### Qué cambió\n\n- …"}
                              disabled={!canWrite}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Tag className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  Tags &amp; authors
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Tags are reusable across {product.name}. Every credited author appears on the
                  public entry.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="tagsText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="mobile, performance, api"
                          disabled={!canWrite}
                        />
                      </FormControl>
                      <FormDescription>
                        Comma-separated, up to 8. Duplicates are removed by tag name.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="authorIds"
                  render={() => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Users className="size-3.5" aria-hidden="true" />
                        Authors
                      </FormLabel>
                      <div className="space-y-1 rounded-md border p-2">
                        {authorOptions.map((member) => {
                          const id = `release-author-${member.id}`;
                          const checked = (values.authorIds ?? []).includes(member.id);
                          return (
                            <label
                              key={member.id}
                              htmlFor={id}
                              className="flex cursor-pointer items-center gap-2.5 rounded-sm px-1 py-1.5 hover:bg-muted/50"
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={(next) => {
                                  const current = values.authorIds ?? [];
                                  if (!next && current.length <= 1) return;
                                  form.setValue(
                                    "authorIds",
                                    next
                                      ? [...current, member.id]
                                      : current.filter((value) => value !== member.id),
                                    { shouldDirty: true, shouldValidate: true },
                                  );
                                }}
                                disabled={!canWrite}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{member.name}</span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {member.email}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Linked feedback</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Publishing marks linked requests as shipped, which moves them to Done on the
                  public roadmap.
                </p>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="linkedFeedbackIds"
                  render={() => (
                    <FormItem>
                      {feedback.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No feedback requests yet. They can be linked after the release exists.
                        </p>
                      ) : (
                        <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
                          {feedback.map((post) => {
                            const id = `release-feedback-${post.id}`;
                            const checked = (values.linkedFeedbackIds ?? []).includes(post.id);
                            return (
                              <label
                                key={post.id}
                                htmlFor={id}
                                className="flex cursor-pointer items-start gap-2.5 rounded-sm px-1.5 py-1.5 hover:bg-muted/50"
                              >
                                <Checkbox
                                  id={id}
                                  checked={checked}
                                  onCheckedChange={(next) =>
                                    toggleArrayValue("linkedFeedbackIds", post.id, next === true)
                                  }
                                  disabled={!canWrite}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">{post.title}</span>
                                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span>{getVoteCount(state, post.id)} votes</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{post.authorName}</span>
                                  </span>
                                </span>
                                <FeedbackStatusBadge status={post.status} />
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Distribution</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Choose every surface this release appears on.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField
                  control={form.control}
                  name="channels.publicChangelog"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                      <div>
                        <FormLabel className="flex items-center gap-1.5">
                          <Globe2 className="size-3.5" aria-hidden="true" />
                          Public changelog
                        </FormLabel>
                        <FormDescription>{product.name} changelog</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={!canWrite}
                          aria-label="Distribute on the public changelog"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {!product.publicChangelogEnabled ? (
                  <p className="rounded-md border border-warning/30 bg-warning-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-warning">
                    The product&apos;s public changelog is off. This release will stay private until
                    it is enabled under Roadmap → Public surfaces.
                  </p>
                ) : null}
                <FormField
                  control={form.control}
                  name="channels.inAppWidget"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                      <div>
                        <FormLabel className="flex items-center gap-1.5">
                          <Puzzle className="size-3.5" aria-hidden="true" />
                          In-app widget
                        </FormLabel>
                        <FormDescription>What&apos;s New release list</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={!canWrite}
                          aria-label="Distribute in the in-app widget"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="channels.subscriberEmail"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                      <div>
                        <FormLabel className="flex items-center gap-1.5">
                          <Mail className="size-3.5" aria-hidden="true" />
                          Subscriber email
                        </FormLabel>
                        <FormDescription>
                          {activeSubscribers} active recipients before suppression. Publishing
                          records pending delivery rows; no email provider is connected.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={!canWrite}
                          aria-label="Queue subscriber email notifications"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {form.formState.errors.channels ? (
                  <p className="text-sm font-medium text-destructive" role="alert">
                    {form.formState.errors.channels.message ??
                      form.formState.errors.channels.root?.message}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setAudienceOpen(true)}
                >
                  <Users aria-hidden="true" />
                  Preview email audience
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Publication</CardTitle>
                {existing?.publishedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Published <DualTimestamp iso={existing.publishedAt} timeZone={timeZone} />.
                    Updates keep the original publication date.
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {!isPublished ? (
                  <FormField
                    control={form.control}
                    name="publishMode"
                    render={({ field }) => (
                      <FormItem>
                        <fieldset className="space-y-2">
                          <legend className="sr-only">Publish timing</legend>
                          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
                            <input
                              type="radio"
                              name="publish-mode"
                              className="mt-0.5 size-4 accent-[var(--primary)]"
                              checked={field.value === "now"}
                              onChange={() => field.onChange("now")}
                              disabled={!canWrite}
                            />
                            <span>
                              <span className="block text-sm font-medium">Publish immediately</span>
                              <span className="block text-[11px] text-muted-foreground">
                                Confirmation is required and shows every channel.
                              </span>
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
                            <input
                              type="radio"
                              name="publish-mode"
                              className="mt-0.5 size-4 accent-[var(--primary)]"
                              checked={field.value === "schedule"}
                              onChange={() => field.onChange("schedule")}
                              disabled={!canWrite}
                            />
                            <span>
                              <span className="block text-sm font-medium">Schedule for later</span>
                              <span className="block text-[11px] text-muted-foreground">
                                Nothing sends before the chosen time.
                              </span>
                            </span>
                          </label>
                        </fieldset>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                {publishMode === "schedule" && !isPublished ? (
                  <FormField
                    control={form.control}
                    name="scheduledFor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Publish date and time</FormLabel>
                        <FormControl>
                          <Input
                            type="datetime-local"
                            {...field}
                            disabled={!canWrite}
                            aria-label="Scheduled publication date and time"
                          />
                        </FormControl>
                        <FormDescription>Times are in {tz}.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                {existing && !isPublished ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Current status:{" "}
                    <ReleaseStatusBadge status={existing.status} />
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  Cancellation reasons
                  <MessageSquare className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Link reasons this release addresses. Links power win-back opportunities; they do
                  not send anything.
                </p>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="linkedCancellationReasonIds"
                  render={() => (
                    <FormItem>
                      {reasons.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No cancellation reasons yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {reasons.map((reason) => {
                            const id = `release-reason-${reason.id}`;
                            const checked = (values.linkedCancellationReasonIds ?? []).includes(
                              reason.id,
                            );
                            return (
                              <label
                                key={reason.id}
                                htmlFor={id}
                                className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1.5 hover:bg-muted/50"
                              >
                                <Checkbox
                                  id={id}
                                  checked={checked}
                                  onCheckedChange={(next) =>
                                    toggleArrayValue(
                                      "linkedCancellationReasonIds",
                                      reason.id,
                                      next === true,
                                    )
                                  }
                                  disabled={!canWrite || !canManageWinback}
                                  className="mt-0.5"
                                />
                                <span className="text-sm">{reason.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {!canManageWinback ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Editors can edit release content but not win-back reason links.
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
              <Button type="button" variant="outline" onClick={handleReviewPublish}>
                <CalendarClock aria-hidden="true" />
                {isPublished
                  ? "Review update"
                  : publishMode === "schedule"
                    ? "Review schedule"
                    : "Review & publish"}
              </Button>
              {!isPublished ? (
                <Button type="button" variant="ghost" onClick={handleSaveDraft}>
                  <Save aria-hidden="true" />
                  Save draft
                </Button>
              ) : null}
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Publishing never approves or sends a win-back campaign.
              </p>
            </div>
          </div>
        </form>
      </Form>

      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {!isPublished ? (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={handleSaveDraft}
            disabled={!canWrite || form.formState.isSubmitting}
          >
            <Save aria-hidden="true" />
            Save draft
          </Button>
        ) : null}
        <Button
          type="button"
          className="flex-1"
          onClick={handleReviewPublish}
          disabled={!canWrite}
        >
          <CalendarClock aria-hidden="true" />
          {isPublished
            ? "Review update"
            : publishMode === "schedule"
              ? "Review schedule"
              : "Review & publish"}
        </Button>
      </div>

      <ReleasePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        release={previewRelease}
        product={product}
        workspace={workspace}
      />

      {existing ? (
        <AiDraftDialog
          open={aiRewriteOpen}
          onOpenChange={setAiRewriteOpen}
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          mode="rewrite"
          releaseId={existing.id}
          onRewritten={applyAiRewrite}
        />
      ) : null}

      <PublishReviewDialog
        open={reviewOpen}
        onOpenChange={(open) => {
          setReviewOpen(open);
          if (!open) setPendingValues(null);
        }}
        title={pendingValues?.title || title || "Untitled release"}
        summary={pendingValues?.summary ?? values.summary ?? ""}
        cover={
          pendingValues?.cover ?? values.cover ?? { kind: "preset", preset: "grid" }
        }
        channels={
          pendingValues?.channels ?? {
            publicChangelog: true,
            inAppWidget: false,
            subscriberEmail: false,
          }
        }
        scheduledFor={
          pendingMode === "schedule" && pendingValues
            ? zonedInputToIso(pendingValues.scheduledFor, timeZone)
            : null
        }
        workspace={workspace}
        product={product}
        activeSubscriberCount={activeSubscribers}
        mode={pendingMode}
        onConfirm={() => void handleConfirmReview()}
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        releaseId={existing?.id ?? ""}
        currentSnapshot={workingSnapshot}
        linkedFeedbackIds={pendingValues?.linkedFeedbackIds ?? values.linkedFeedbackIds ?? []}
        tagSlugs={releaseTagSlugs}
        teamMembers={state.teamMembers}
        feedbackPosts={state.feedbackPosts}
        cancellationReasons={reasons}
      />

      {existing ? (
        <ReleaseHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          releaseId={existing.id}
          workingSnapshot={workingSnapshot}
          timeZone={timeZone}
          teamMembers={state.teamMembers}
          feedbackPosts={state.feedbackPosts}
          cancellationReasons={reasons}
          onRestored={applyRestoredRevision}
        />
      ) : null}

      <AudiencePreviewDialog
        open={audienceOpen}
        onOpenChange={setAudienceOpen}
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        linkedFeedbackIds={values.linkedFeedbackIds ?? []}
        tagSlugs={releaseTagSlugs}
        emailEnabled={values.channels?.subscriberEmail ?? false}
      />

      <InlineImageAltDialog
        images={pendingInlineImages}
        onCancel={() => setPendingInlineImages([])}
        onConfirm={confirmInlineImages}
      />
    </div>
  );
}
