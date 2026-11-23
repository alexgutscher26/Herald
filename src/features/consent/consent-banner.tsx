"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useOptionalPublicI18n } from "@/features/public/i18n/provider";
import type { PublicMessageKey } from "@/features/public/i18n/messages/en";

import {
  detectRestrictedJurisdiction,
  getServerConsentSnapshot,
  readConsentSnapshot,
  subscribeConsent,
  writeClientConsent,
} from "./client";
import { CONSENT_EVENT, CONSENT_OPEN_EVENT } from "./core";

/**
 * Accessible consent banner.
 *
 * It is a non-modal region rather than a focus trap: the page stays usable
 * before a choice is made, and "Essential only" is always available as the
 * dismiss action. The decision is stored in a first-party cookie and announced
 * through a custom event so an already-open embed can react without a reload.
 */
export function ConsentBanner({ initialRestricted }: { initialRestricted?: boolean }) {
  const i18n = useOptionalPublicI18n();
  const router = useRouter();
  const raw = useSyncExternalStore(
    subscribeConsent,
    readConsentSnapshot,
    getServerConsentSnapshot,
  );
  const [opened, setOpened] = useState(false);
  const restricted = initialRestricted ?? detectRestrictedJurisdiction();

  useEffect(() => {
    const close = () => setOpened(false);
    const reopen = () => setOpened(true);
    window.addEventListener(CONSENT_EVENT, close);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => {
      window.removeEventListener(CONSENT_EVENT, close);
      window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
    };
  }, []);

  // `null` means the server/hydration pass: there is no cookie to inspect yet.
  if (raw === null) return null;
  // A stored decision hides the banner until “Cookie settings” reopens it.
  if (raw !== "" && !opened) return null;

  const text = (key: PublicMessageKey, fallback: string) => i18n?.t(key) ?? fallback;

  const choose = (acceptAll: boolean) => {
    writeClientConsent({ analytics: acceptAll, embeds: acceptAll });
    setOpened(false);
    // Public analytics is rendered server-side, so the new choice takes effect
    // on the next request rather than only in this tab.
    router.refresh();
  };

  return (
    <section
      aria-labelledby="consent-title"
      aria-describedby="consent-description"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-xl border bg-card p-4 text-foreground shadow-lg sm:inset-x-6 sm:p-5"
    >
      <h2 id="consent-title" className="text-base font-semibold tracking-tight">
        {text("consent.title", "Your cookie choices")}
      </h2>
      <p id="consent-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {restricted
          ? text(
              "consent.bodyRestricted",
              "You are in a region where optional cookies need your permission first. Herald uses essential cookies to keep the site working. Optional analytics — processed for us by PostHog under a pseudonymous key — and YouTube embeds stay off until you allow them.",
            )
          : text(
              "consent.bodyDefault",
              "Herald uses essential cookies to keep the site working. Optional analytics help us understand which pages are useful and are processed for us by PostHog under a pseudonymous key. YouTube videos stay blocked until you allow them. We do not use advertising cookies.",
            )}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {text(
          "consent.essentialNote",
          "Essential cookies always stay on. You can change this choice at any time with “Cookie settings”.",
        )}{" "}
        <Link href="/legal/privacy#cookies" className="underline underline-offset-2">
          {text("consent.privacy", "Privacy policy")}
        </Link>
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => choose(false)}
          className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
        >
          {text("consent.essentialOnly", "Essential only")}
        </button>
        <button
          type="button"
          onClick={() => choose(true)}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {text("consent.acceptAll", "Accept all")}
        </button>
      </div>
    </section>
  );
}
