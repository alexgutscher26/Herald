"use client";

import { Play } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { useOptionalPublicI18n } from "@/features/public/i18n/provider";
import { youTubeEmbedUrl } from "@/features/releases/youtube";

import {
  getServerConsentSnapshot,
  readConsentSnapshot,
  subscribeConsent,
  writeClientConsent,
} from "@/features/consent/client";
import { parseConsentCookie } from "@/features/consent/core";

/**
 * Privacy-enhanced YouTube player.
 *
 * The iframe is not rendered until the visitor allows embeds. A click on the
 * placeholder records only the embed permission; it never turns analytics on.
 * The stored URL is still validated before use, so a malformed row cannot inject
 * an arbitrary iframe source into a public page.
 */
export function YouTubeEmbed({
  url,
  title,
  className,
}: {
  url: string | null | undefined;
  title: string;
  className?: string;
}) {
  const i18n = useOptionalPublicI18n();
  const src = youTubeEmbedUrl(url);
  const raw = useSyncExternalStore(
    subscribeConsent,
    readConsentSnapshot,
    getServerConsentSnapshot,
  );
  const allowed = raw ? (parseConsentCookie(raw)?.embeds ?? false) : false;

  if (!src) return null;

  const text = (key: "consent.embedTitle" | "consent.embedBody" | "consent.embedLoad", fallback: string) =>
    i18n?.t(key) ?? fallback;

  if (!allowed) {
    return (
      <div
        className={cn(
          "flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border bg-muted/40 p-4 text-center",
          className,
        )}
      >
        <p className="text-sm font-medium">{text("consent.embedTitle", "YouTube video")}</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {text(
            "consent.embedBody",
            "Loading the player lets YouTube set cookies and receive your IP address.",
          )}
        </p>
        <button
          type="button"
          onClick={() => {
            const current = parseConsentCookie(raw ?? "");
            writeClientConsent({ analytics: current?.analytics ?? false, embeds: true });
          }}
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted"
        >
          <Play className="size-3.5" aria-hidden="true" />
          {text("consent.embedLoad", "Load video")}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-black/5 shadow-sm",
        className,
      )}
    >
      <iframe
        src={src}
        title={`${title} video`}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="aspect-video w-full"
      />
    </div>
  );
}
