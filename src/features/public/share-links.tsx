"use client";

import { Check, Copy, ExternalLink, Mail, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { usePublicI18n } from "./i18n/provider";

/**
 * Share controls.
 *
 * URLs are built from `window.location` at click time so the links are
 * absolute even when the app is served from a different origin than the
 * configured canonical one.
 */
export function ShareLinks({ path, title }: { path: string; title: string }) {
  const { t } = usePublicI18n();
  const [copied, setCopied] = useState(false);

  function absoluteUrl(): string {
    return new URL(path, window.location.origin).toString();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  function shareX() {
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(absoluteUrl())}&text=${encodeURIComponent(title)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function shareLinkedIn() {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(absoluteUrl())}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? t("share.copied") : t("share.copyLink")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={shareX}>
        <Share2 aria-hidden="true" />
        {t("share.share")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={shareLinkedIn}>
        <ExternalLink aria-hidden="true" />
        {t("share.linkedin")}
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`mailto:?subject=${encodeURIComponent(title)}`} onClick={(event) => {
          event.preventDefault();
          window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(absoluteUrl())}`;
        }}>
          <Mail aria-hidden="true" />
          {t("share.email")}
        </a>
      </Button>
    </div>
  );
}
