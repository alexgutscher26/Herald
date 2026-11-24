"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { errorMessage, sendJson } from "./client";
import { usePublicI18n } from "./i18n/provider";

/** Comment composer; reports a moderation receipt instead of clearing silently. */
export function CommentForm({
  requestApiBase,
  hasCompany,
  variant = "default",
}: {
  requestApiBase: string;
  hasCompany: boolean;
  variant?: "default" | "widget";
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [body, setBody] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "author" | "company">("public");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const bodyInput = useRef<HTMLTextAreaElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError("");
    setReceipt("");

    const result = await sendJson(`${requestApiBase}/comments`, "POST", {
      body: body.trim(),
      privacy,
    });

    if (!result.ok) {
      setError(errorMessage(result, t("comment.error")));
      window.requestAnimationFrame(() => bodyInput.current?.focus());
    } else {
      setBody("");
      setReceipt(
        result.data.status === "awaiting_review" ? t("comment.awaitingReview") : "",
      );
      router.refresh();
    }

    setPending(false);
  }

  const compact = variant === "widget";

  return (
    <form
      onSubmit={submit}
      className={cn("space-y-2", compact ? "mt-2" : "mt-4")}
    >
      <Label htmlFor="comment-body" className="sr-only">
        {t("comment.label")}
      </Label>
      <div
        className={cn(
          compact
            ? "rounded-[18px] border border-border/70 bg-card p-3 shadow-sm transition-colors focus-within:border-primary/40"
            : "space-y-2",
        )}
      >
        <Textarea
          ref={bodyInput}
          id="comment-body"
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("comment.placeholder")}
          minLength={2}
          maxLength={4_000}
          required
          aria-invalid={error !== ""}
          aria-describedby={error ? "comment-error" : undefined}
          className={cn(
            compact &&
              "min-h-20 resize-none border-0 bg-transparent px-0 py-0 text-[12.5px] leading-relaxed shadow-none focus-visible:ring-0",
          )}
        />
        <div
          className={cn(
            compact
              ? "mt-2 flex flex-wrap items-center justify-between gap-2"
              : "flex flex-wrap items-center gap-3",
          )}
        >
          <label htmlFor="comment-privacy" className="sr-only">
            {t("privacy.label")}
          </label>
          <select
            id="comment-privacy"
            value={privacy}
            onChange={(event) =>
              setPrivacy(event.target.value as "public" | "author" | "company")
            }
            className={cn(
              "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              compact &&
                "h-8 rounded-full border-border/70 bg-background px-3 text-[11px] shadow-none",
            )}
          >
            <option value="public">{t("privacy.public")}</option>
            <option value="author">{t("privacy.author")}</option>
            {hasCompany ? (
              <option value="company">{t("privacy.company")}</option>
            ) : null}
          </select>
          <Button
            type="submit"
            size="sm"
            disabled={pending || body.trim().length < 2}
            className={cn(compact && "h-8 rounded-full px-3.5 text-[11px]")}
          >
            {pending ? t("comment.posting") : t("comment.post")}
          </Button>
        </div>
      </div>
      {error ? (
        <p id="comment-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {receipt ? (
        <p
          role="status"
          className="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-xs text-warning"
        >
          {receipt}
        </p>
      ) : null}
    </form>
  );
}
