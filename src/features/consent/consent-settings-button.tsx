"use client";

import { useOptionalPublicI18n } from "@/features/public/i18n/provider";

import { CONSENT_OPEN_EVENT } from "./core";

/** Reopens the consent banner from any footer or header. */
export function ConsentSettingsButton({ className }: { className?: string }) {
  const i18n = useOptionalPublicI18n();

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
      className={className ?? "inline-flex min-h-6 items-center text-left hover:underline"}
    >
      {i18n?.t("consent.settings") ?? "Cookie settings"}
    </button>
  );
}
