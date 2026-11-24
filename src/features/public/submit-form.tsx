"use client";

import { Image as ImageIcon, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { CustomFieldInputs } from "@/components/shared/custom-field-inputs";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

import type { IntakeQuestionView } from "@/features/conversations/intake";

import { errorMessage } from "./client";
import { formatBytes } from "./format";
import { usePublicI18n } from "./i18n/provider";
import type { PublicMessageKey } from "./i18n";
import { ScreenshotAnnotator } from "./screenshot-annotator";
import {
  widgetEmbedHref,
  type WidgetQuery,
  type WidgetRoute,
} from "@/features/widget/paths";

import { publicSubmitPath } from "./paths";
import { PUBLIC_STATUS_TONES } from "./presentation";
import type { SubmissionRewrite } from "./rewrite-prompt";
import type {
  PublicBoardSummary,
  PublicCustomField,
  PublicFeedbackStatus,
  PublicSuggestion,
} from "./types";

/**
 * Submission form.
 *
 * Suggestions are fetched while the title is typed. In the widget composer a
 * strong title match opens a confirmation before posting, but the author can
 * still choose to post a different request. The board picker navigates to that
 * board's form so the server always creates the request inside the posted URL.
 */

const CATEGORIES = [
  { id: "feature_request", labelKey: "common.category.feature_request" },
  { id: "bug", labelKey: "common.category.bug" },
  { id: "improvement", labelKey: "common.category.improvement" },
  { id: "question", labelKey: "common.category.question" },
] as const satisfies readonly { id: string; labelKey: PublicMessageKey }[];

const MAX_ATTACHMENTS = 3;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const STATUS_LABELS: Record<PublicFeedbackStatus, PublicMessageKey> = {
  open: "common.status.open",
  under_review: "common.status.under_review",
  planned: "common.status.planned",
  in_progress: "common.status.in_progress",
  shipped: "common.status.shipped",
  closed: "common.status.closed",
};

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

const TITLE_MATCH_STOPWORDS = new Set([
  "add",
  "all",
  "and",
  "any",
  "are",
  "but",
  "can",
  "could",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "not",
  "our",
  "out",
  "please",
  "should",
  "that",
  "the",
  "this",
  "use",
  "using",
  "was",
  "were",
  "what",
  "when",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** A high-overlap title match is strong enough to confirm before posting. */
function strongTitleMatch(title: string, candidate: string): boolean {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (word) => word.length >= 3 && !TITLE_MATCH_STOPWORDS.has(word),
        ),
    );

  const query = tokens(title);
  const match = tokens(candidate);
  if (query.size === 0 || match.size === 0) return false;

  let shared = 0;
  for (const word of query) {
    if (match.has(word)) shared += 1;
  }

  return shared / Math.min(query.size, match.size) >= 0.6;
}


export function SubmitForm({
  workspaceSlug,
  productSlug,
  boardSlug,
  boards,
  customFields,
  intakeQuestions,
  aiRewriteEnabled,
  guestPosting,
  identified,
  hasCompany,
  mode = "page",
  widgetQuery,
}: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  boards: PublicBoardSummary[];
  /** Typed fields defined for this product, already filtered to active ones. */
  customFields: PublicCustomField[];
  /** Optional questions for this board; the form works without answers. */
  intakeQuestions: IntakeQuestionView[];
  /** The product opted in and the deployment has an AI provider. */
  aiRewriteEnabled: boolean;
  guestPosting: boolean;
  identified: boolean;
  /** The visitor belongs to a company, so a company-only audience exists. */
  hasCompany: boolean;
  /** `embed` keeps the board picker, suggestions and receipt inside the widget. */
  mode?: "page" | "embed";
  /** Theme, locale, host and public key to keep across widget links. */
  widgetQuery?: WidgetQuery;
}) {
  const router = useRouter();
  const { t, tc } = usePublicI18n();
  const composer = mode === "embed";
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const errorAlert = useRef<HTMLParagraphElement>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>(
    "feature_request",
  );
  const [privacy, setPrivacy] = useState<"public" | "author" | "company">("public");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<PublicSuggestion[]>([]);
  const [duplicateGate, setDuplicateGate] = useState<PublicSuggestion[] | null>(
    null,
  );
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [fileError, setFileError] = useState("");
  const [pending, setPending] = useState(false);
  const [rewriteProposal, setRewriteProposal] = useState<SubmissionRewrite | null>(
    null,
  );
  const [rewritePending, setRewritePending] = useState(false);
  const [rewriteApplied, setRewriteApplied] = useState(false);
  const [originalWording, setOriginalWording] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [selectedSplits, setSelectedSplits] = useState<number[]>([]);

  const suggestionsUrl = useMemo(
    () =>
      `/api/public/boards/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
        productSlug,
      )}/${encodeURIComponent(boardSlug)}/requests/suggestions`,
    [workspaceSlug, productSlug, boardSlug],
  );

  useEffect(() => {
    const query = title.trim();
    if (query.length < 3 || pending) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
        const response = await fetch(
          `${suggestionsUrl}?q=${encodeURIComponent(query.slice(0, 120))}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;

        const data = (await response.json()) as {
          suggestions?: PublicSuggestion[];
        };
        setSuggestions(
          Array.isArray(data.suggestions) ? data.suggestions.slice(0, 5) : [],
        );
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") {
          setSuggestions([]);
        }
      }
      })();
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [title, pending, suggestionsUrl]);

  async function findSuggestions(value: string): Promise<PublicSuggestion[]> {
    const query = value.trim();
    if (query.length < 3) return [];

    try {
      const response = await fetch(
        `${suggestionsUrl}?q=${encodeURIComponent(query.slice(0, 120))}`,
      );
      if (!response.ok) return [];
      const data = (await response.json()) as {
        suggestions?: PublicSuggestion[];
      };
      return Array.isArray(data.suggestions) ? data.suggestions.slice(0, 5) : [];
    } catch {
      // A failed suggestion check should not stop the author from posting.
      return [];
    }
  }

  function suggestionHref(suggestion: PublicSuggestion): string {
    return mode === "embed"
      ? widgetEmbedHref(
          workspaceSlug,
          productSlug,
          {
            view: "feedback",
            boardSlug: suggestion.boardSlug,
            requestId: suggestion.id,
          },
          widgetQuery ?? {},
        )
      : `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/${encodeURIComponent(suggestion.boardSlug)}/${encodeURIComponent(
          suggestion.id,
        )}`;
  }

  function focusField(name: string) {
    if (name === "title") titleInput.current?.focus();
    else if (name === "body") bodyInput.current?.focus();
    else if (name === "email") emailInput.current?.focus();
    else errorAlert.current?.focus();
  }

  function chooseFiles(list: FileList | null) {
    const selected = list ? [...list].filter((file) => file.size > 0) : [];
    setFileError("");

    if (selected.length > MAX_ATTACHMENTS) {
      setFileError(t("submit.fileCount", { count: MAX_ATTACHMENTS }));
      setFiles([]);
      return;
    }

    const total = selected.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      setFileError(t("submit.fileSize"));
      setFiles([]);
      return;
    }

    setFiles(selected);
  }

  function addScreenshot(file: File) {
    const next = [...files, file];
    if (next.length > MAX_ATTACHMENTS) {
      setFileError(t("submit.fileCount", { count: MAX_ATTACHMENTS }));
      return;
    }
    const total = next.reduce((sum, entry) => sum + entry.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      setFileError(t("submit.fileSize"));
      return;
    }
    setFileError("");
    setFiles(next);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, position) => position !== index));
    setFileError("");
  }

  async function requestRewrite() {
    if (title.trim().length < 3 || body.trim().length < 10) {
      (title.trim().length < 3 ? titleInput : bodyInput).current?.focus();
      return;
    }

    setRewritePending(true);
    try {
      const response = await fetch(
        `/api/public/boards/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/${encodeURIComponent(boardSlug)}/rewrite`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, body }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        rewrite?: SubmissionRewrite;
        error?: string;
      };
      if (!response.ok || !data.rewrite) {
        return;
      }
      setRewriteProposal(data.rewrite);
      setRewriteApplied(false);
      setOriginalWording(null);
      setSelectedSplits([]);
    } catch {
      // The rewrite is optional; abandoning it leaves the original text.
    } finally {
      setRewritePending(false);
    }
  }

  function applyRewrite() {
    if (!rewriteProposal) return;
    setOriginalWording({ title, body });
    setTitle(rewriteProposal.title);
    setBody(rewriteProposal.body);
    setRewriteApplied(true);
    setSuggestions([]);
  }

  function restoreWording() {
    if (!originalWording) return;
    setTitle(originalWording.title);
    setBody(originalWording.body);
    setRewriteApplied(false);
    setOriginalWording(null);
  }

  function toggleSplit(index: number) {
    setSelectedSplits((current) =>
      current.includes(index)
        ? current.filter((selected) => selected !== index)
        : [...current, index],
    );
  }

  async function submitRequest(skipDuplicateCheck = false) {
    if (pending) return;

    if (composer && !skipDuplicateCheck) {
      setPending(true);
      const matches = await findSuggestions(title);
      setPending(false);
      const strongMatches = matches.filter((suggestion) =>
        strongTitleMatch(title, suggestion.title),
      );
      if (strongMatches.length > 0) {
        setSuggestions(matches);
        setDuplicateGate(strongMatches);
        return;
      }
    }

    setPending(true);
    setError("");
    setField("");
    setCustomFieldErrors({});

    const form = new FormData();
    form.set("title", title);
    form.set("body", body);
    form.set("category", category);
    form.set("privacy", privacy);
    form.set("custom_fields", JSON.stringify(customFieldValues));
    form.set("intake", JSON.stringify(intakeAnswers));
    if (rewriteApplied && originalWording) {
      form.set("rewrite_accepted", "1");
      form.set("original_title", originalWording.title);
      form.set("original_body", originalWording.body);
    }
    if (rewriteProposal) {
      const splits = rewriteProposal.splits.filter((_, index) =>
        selectedSplits.includes(index),
      );
      if (splits.length > 0) form.set("splits", JSON.stringify(splits));
    }
    if (email.trim() !== "") form.set("email", email);
    if (name.trim() !== "") form.set("name", name);
    for (const file of files) form.append("attachments", file);

    try {
      const response = await fetch(
        `/api/public/boards/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/${encodeURIComponent(boardSlug)}/requests`,
        { method: "POST", body: form },
      );

      const data = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (!response.ok) {
        setError(
          errorMessage({ ok: false, status: response.status, data }, t("submit.error")),
        );
        const invalidField = typeof data.field === "string" ? data.field : "";
        setField(invalidField);
        if (customFields.some((customField) => customField.key === invalidField)) {
          setCustomFieldErrors({
            [invalidField]:
              typeof data.error === "string"
                ? data.error
                : "Check this field and try again.",
          });
        }
        setPending(false);
        // Keep keyboard focus at the problem instead of leaving it on the
        // submit button while an alert appears elsewhere on the page.
        window.requestAnimationFrame(() => focusField(invalidField));
        return;
      }

      const status =
        data.status === "awaiting_review" ? "awaiting_review" : "published";
      const publicPath =
        typeof data.path === "string"
          ? data.path
          : publicSubmitPath(workspaceSlug, productSlug, boardSlug);
      const embedPath =
        mode === "embed" && typeof data.id === "string"
          ? widgetEmbedHref(
              workspaceSlug,
              productSlug,
              {
                view: "feedback",
                boardSlug,
                requestId: data.id,
              },
              widgetQuery ?? {},
            )
          : null;
      const target = embedPath ?? publicPath;
      const separator = target.includes("?") ? "&" : "?";
      router.push(`${target}${separator}submitted=${status}`);
    } catch {
      setError(t("submit.networkError"));
      setPending(false);
      window.requestAnimationFrame(() => errorAlert.current?.focus());
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitRequest();
  }

  const contactFields = (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {guestPosting ? t("submit.guestNote") : t("submit.requiredEmailNote")}
        {identified ? ` ${t("submit.identifiedNote")}` : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor="submit-email"
            className={composer ? "text-[12px] text-muted-foreground" : undefined}
          >
            {t("common.email")}
          </Label>
          <Input
            ref={emailInput}
            id="submit-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            required={!guestPosting && !identified}
            aria-invalid={field === "email"}
            aria-describedby={field === "email" ? "submit-error" : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="submit-name"
            className={composer ? "text-[12px] text-muted-foreground" : undefined}
          >
            {t("common.nameOptional")}
          </Label>
          <Input
            id="submit-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </div>
      </div>
    </>
  );

  return (
    <form
      onSubmit={submit}
      className={
        composer ? "flex min-h-full flex-1 flex-col gap-5" : "space-y-6"
      }
    >
      {composer && boards.length <= 1 ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="submit-board">{t("submit.board")}</Label>
          <select
          id="submit-board"
          className={SELECT_CLASS}
            value={boardSlug}
            onChange={(event) => {
              const route: WidgetRoute = {
                view: "feedback",
                boardSlug: event.target.value,
                compose: true,
              };
              const nextPath =
                mode === "embed"
                  ? widgetEmbedHref(
                      workspaceSlug,
                      productSlug,
                      route,
                      widgetQuery ?? {},
                    )
                  : publicSubmitPath(
                      workspaceSlug,
                      productSlug,
                      event.target.value,
                    );
              router.push(nextPath);
            }}
          >
            {boards.map((board) => (
              <option key={board.slug} value={board.slug}>
                {board.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={composer ? "space-y-1" : "space-y-1.5"}>
        <Label
          htmlFor="submit-title"
          className={composer ? "sr-only" : undefined}
        >
          {t("submit.titleLabel")}
        </Label>
        <Input
          ref={titleInput}
          id="submit-title"
          name="title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            // Clear stale duplicates as soon as the query is too short to match.
            if (event.target.value.trim().length < 3) setSuggestions([]);
          }}
          placeholder={t("submit.titlePlaceholder")}
          className={
            composer
              ? "h-auto rounded-none border-0 bg-transparent px-0 py-0 text-[19px] font-semibold leading-snug shadow-none placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-0"
              : undefined
          }
          minLength={3}
          maxLength={140}
          required
          aria-invalid={field === "title"}
          aria-describedby={
            field === "title"
              ? "submit-title-help submit-error"
              : "submit-title-help"
          }
        />
        <p
          id="submit-title-help"
          className={
            composer ? "sr-only" : "text-xs text-muted-foreground"
          }
        >
          {t("submit.characters", { count: title.trim().length })}
        </p>
      </div>

      {suggestions.length > 0 ? (
        <section
          aria-live="polite"
          aria-label={t("submit.suggestionsHeading")}
          className="rounded-lg border border-info/30 bg-info-muted/40 p-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {t("submit.suggestionsHeading")}
          </h2>
          <ul className="mt-2 space-y-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="text-sm">
                <a
                  href={suggestionHref(suggestion)}
                  target={mode === "embed" ? undefined : "_blank"}
                  rel={mode === "embed" ? undefined : "noreferrer"}
                  className="font-medium text-primary hover:underline"
                >
                  {suggestion.title}
                </a>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusBadge
                    tone={PUBLIC_STATUS_TONES[suggestion.status]}
                    className="rounded-full text-[10px]"
                  >
                    {t(STATUS_LABELS[suggestion.status])}
                  </StatusBadge>
                  <span>{suggestion.boardName}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {tc(
                      "common.voteCount.one",
                      "common.voteCount.other",
                      suggestion.voteCount,
                    )}
                  </span>
                </span>
                <p className="text-xs text-muted-foreground">
                  {suggestion.excerpt}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("submit.suggestionsBody")}
          </p>
        </section>
      ) : null}

      <div className={composer ? "space-y-1" : "space-y-1.5"}>
        <Label
          htmlFor="submit-body"
          className={composer ? "sr-only" : undefined}
        >
          {t("submit.details")}
        </Label>
        <Textarea
          ref={bodyInput}
          id="submit-body"
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            composer
              ? t("widget.feedbackComposePlaceholder")
              : t("submit.detailsPlaceholder")
          }
          className={
            composer
              ? "min-h-[34vh] resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[15px] leading-relaxed shadow-none placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-0"
              : "min-h-40"
          }
          minLength={10}
          maxLength={5_000}
          required
          aria-invalid={field === "body"}
          aria-describedby={field === "body" ? "submit-error" : undefined}
        />
        {!composer && aiRewriteEnabled ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={requestRewrite}
              disabled={
                pending ||
                rewritePending ||
                title.trim().length < 3 ||
                body.trim().length < 10
              }
            >
              {rewritePending ? t("submit.rewriting") : t("submit.rewrite")}
            </Button>
            {rewriteApplied ? (
              <Button type="button" variant="ghost" size="sm" onClick={restoreWording}>
                {t("submit.rewriteRestore")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {!composer && rewriteApplied ? (
          <p className="text-xs text-muted-foreground">{t("submit.rewriteApplied")}</p>
        ) : null}
      </div>

      {!composer && rewriteProposal ? (
        <section
          aria-label={t("submit.rewriteHeading")}
          className="space-y-3 rounded-lg border border-info/30 bg-info-muted/40 p-3"
        >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">
              {t("submit.rewriteHeading")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("submit.rewriteHint")}
            </p>
          </div>
          <div className="rounded-md border bg-card p-3 text-sm">
            <p className="font-medium text-foreground">{rewriteProposal.title}</p>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">
              {rewriteProposal.body}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!rewriteApplied ? (
              <Button type="button" size="sm" onClick={applyRewrite}>
                {t("submit.rewriteUse")}
              </Button>
            ) : null}
            {!rewriteApplied ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRewriteProposal(null);
                  setSelectedSplits([]);
                }}
              >
                {t("submit.rewriteKeep")}
              </Button>
            ) : null}
          </div>

          {rewriteProposal.splits.length > 0 ? (
            <fieldset className="space-y-2 border-t pt-3">
              <legend className="text-sm font-medium text-foreground">
                {t("submit.splitHeading")}
              </legend>
              <p className="text-xs text-muted-foreground">
                {t("submit.splitBody")}
              </p>
              {rewriteProposal.splits.map((split, index) => (
                <label
                  key={`${split.title}-${index}`}
                  className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedSplits.includes(index)}
                    onChange={() => toggleSplit(index)}
                    disabled={pending}
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium text-foreground">
                      {split.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {split.body}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </section>
      ) : null}

      {composer ? null : (
        <div className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="submit-category">{t("submit.type")}</Label>
            <select
              id="submit-category"
              className={SELECT_CLASS}
              value={category}
              onChange={(event) =>
                setCategory(
                  event.target.value as (typeof CATEGORIES)[number]["id"],
                )
              }
            >
              {CATEGORIES.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="submit-privacy">{t("privacy.label")}</Label>
            <select
              id="submit-privacy"
              className={SELECT_CLASS}
              value={privacy}
              onChange={(event) =>
                setPrivacy(
                  event.target.value as "public" | "author" | "company",
                )
              }
              aria-describedby="submit-privacy-help"
            >
              <option value="public">{t("privacy.public")}</option>
              <option value="author">{t("privacy.author")}</option>
              {hasCompany ? (
                <option value="company">{t("privacy.company")}</option>
              ) : null}
            </select>
            <p
              id="submit-privacy-help"
              className="text-xs text-muted-foreground"
            >
              {privacy === "public"
                ? t("privacy.publicHint")
                : privacy === "author"
                  ? t("privacy.authorHint")
                  : t("privacy.companyHint")}
            </p>
          </div>
        </div>
      )}

      {intakeQuestions.length > 0 ? (
        <fieldset className="space-y-3 rounded-lg border bg-card p-4">
          <legend className="px-1 text-sm font-medium text-foreground">
            Help us route this (optional)
          </legend>
          {intakeQuestions.map((question) =>
            question.kind === "select" ? (
              <div key={question.id} className="space-y-1.5">
                <Label htmlFor={`submit-intake-${question.key}`}>{question.label}</Label>
                <select
                  id={`submit-intake-${question.key}`}
                  className={SELECT_CLASS}
                  value={intakeAnswers[question.key] ?? ""}
                  onChange={(event) =>
                    setIntakeAnswers((current) => ({
                      ...current,
                      [question.key]: event.target.value,
                    }))
                  }
                  disabled={pending}
                >
                  <option value="">Prefer not to say</option>
                  {question.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div key={question.id} className="space-y-1.5">
                <Label htmlFor={`submit-intake-${question.key}`}>{question.label}</Label>
                <Input
                  id={`submit-intake-${question.key}`}
                  maxLength={500}
                  value={intakeAnswers[question.key] ?? ""}
                  onChange={(event) =>
                    setIntakeAnswers((current) => ({
                      ...current,
                      [question.key]: event.target.value,
                    }))
                  }
                  disabled={pending}
                />
              </div>
            ),
          )}
          <p className="text-xs text-muted-foreground">
            Every question is optional; you can submit without answering.
          </p>
        </fieldset>
      ) : null}

      {customFields.length > 0 ? (
        <fieldset className="space-y-3 rounded-lg border bg-card p-4">
          <legend className="px-1 text-sm font-medium text-foreground">
            Additional details
          </legend>
          <CustomFieldInputs
            fields={customFields}
            values={customFieldValues}
            onChange={(key, value) => {
              setCustomFieldValues((current) => ({ ...current, [key]: value }));
              setCustomFieldErrors((current) => {
                if (!(key in current)) return current;
                const next = { ...current };
                delete next[key];
                return next;
              });
            }}
            errors={customFieldErrors}
            idPrefix="submit-field"
            disabled={pending}
          />
        </fieldset>
      ) : null}

      {composer ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="submit-files">{t("submit.attachments")}</Label>
          <input
            ref={fileInput}
            id="submit-files"
            name="attachments"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain"
            onChange={(event) => chooseFiles(event.target.files)}
            aria-invalid={Boolean(fileError)}
            aria-describedby={fileError ? "submit-file-error" : undefined}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <p className="text-xs text-muted-foreground">
            {t("submit.attachmentsHint", { count: MAX_ATTACHMENTS })}
          </p>
          {files.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex items-center gap-2"
                >
                  <span className="min-w-0 truncate">
                    {file.name} · {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={t("submit.removeFile", { name: file.name })}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {fileError ? (
            <p
              id="submit-file-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {fileError}
            </p>
          ) : null}

          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium text-foreground">
              {t("submit.screenshot")}
            </p>
            <ScreenshotAnnotator
              disabled={pending || files.length >= MAX_ATTACHMENTS}
              onAdd={addScreenshot}
            />
          </div>
        </div>
      )}

      {composer ? (
        guestPosting || identified ? null : (
          <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-card/40 p-4">
            <legend className="px-1 text-sm font-medium text-foreground">
              {t("submit.yourDetails")}
            </legend>
            {contactFields}
          </fieldset>
        )
      ) : (
        <fieldset className="space-y-3 rounded-lg border bg-card p-4">
          <legend className="px-1 text-sm font-medium text-foreground">
            {t("submit.yourDetails")}
          </legend>
          {contactFields}
        </fieldset>
      )}

      {error ? (
        <p
          ref={errorAlert}
          id="submit-error"
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {composer ? (
        <div className="sticky bottom-0 z-20 -mx-4 mt-auto border-t border-border/60 bg-background px-4 pb-2.5 pt-2">
          <input
            ref={fileInput}
            id="submit-files"
            name="attachments"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain"
            onChange={(event) => chooseFiles(event.target.files)}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />

          {files.length > 0 ? (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex max-w-full items-center gap-1 rounded-full border border-border/80 bg-card py-1 pl-2.5 pr-1.5 text-[10.5px] text-muted-foreground"
                >
                  <span className="max-w-40 truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    aria-label={t("submit.removeFile", { name: file.name })}
                    className="rounded-full p-0.5 transition-colors hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {fileError ? (
            <p
              id="submit-file-error"
              role="alert"
              className="mb-2 text-[11px] text-destructive"
            >
              {fileError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={t("widget.attachImage")}
                title={t("widget.attachImage")}
                disabled={pending || files.length >= MAX_ATTACHMENTS}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <ImageIcon className="size-[18px]" aria-hidden="true" />
              </button>
              <ScreenshotAnnotator
                variant="icon"
                disabled={pending || files.length >= MAX_ATTACHMENTS}
                onAdd={addScreenshot}
              />
            </div>

            <Button
              type="submit"
              disabled={
                pending ||
                title.trim().length < 3 ||
                body.trim().length < 10
              }
              className="h-9 rounded-full bg-foreground px-5 text-[13px] font-semibold text-background shadow-none hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            >
              {pending ? t("submit.posting") : t("widget.feedbackPost")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? t("submit.posting") : t("submit.post")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("submit.receiptNote")}
          </p>
        </div>
      )}

      <Dialog
        open={duplicateGate !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateGate(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("submit.duplicateTitle")}</DialogTitle>
            <DialogDescription>{t("submit.duplicateBody")}</DialogDescription>
          </DialogHeader>

          <ul className="space-y-2">
            {(duplicateGate ?? []).slice(0, 3).map((suggestion) => (
              <li key={suggestion.id}>
                <a
                  href={suggestionHref(suggestion)}
                  onClick={() => setDuplicateGate(null)}
                  className="block rounded-lg border bg-card p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">
                      {suggestion.title}
                    </span>
                    <StatusBadge
                      tone={PUBLIC_STATUS_TONES[suggestion.status]}
                      className="rounded-full text-[10px]"
                    >
                      {t(STATUS_LABELS[suggestion.status])}
                    </StatusBadge>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{suggestion.boardName}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {tc(
                        "common.voteCount.one",
                        "common.voteCount.other",
                        suggestion.voteCount,
                      )}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDuplicateGate(null);
                void submitRequest(true);
              }}
            >
              {t("submit.duplicatePostAnyway")}
            </Button>
            <Button type="button" onClick={() => setDuplicateGate(null)}>
              {t("submit.duplicateKeepEditing")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
