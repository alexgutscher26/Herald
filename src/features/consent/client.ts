"use client";

import {
  CONSENT_COOKIE,
  CONSENT_EVENT,
  CONSENT_MAX_AGE_SECONDS,
  createConsentDecision,
  parseConsentCookie,
  restrictedFromLanguage,
  serializeConsentCookie,
  type ConsentDecision,
  type ConsentPreferences,
} from "./core";

export function readConsentSnapshot(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${CONSENT_COOKIE}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match?.slice(prefix.length) ?? "";
}

/** `null` during SSR so the banner renders only after the client can read it. */
export function getServerConsentSnapshot(): string | null {
  return null;
}

export function readClientConsent(): ConsentDecision | null {
  return parseConsentCookie(readConsentSnapshot());
}

const consentListeners = new Set<() => void>();

function notifyConsentListeners(): void {
  for (const listener of consentListeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  consentListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_COOKIE || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    consentListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function writeClientConsent(preferences: ConsentPreferences): ConsentDecision {
  const decision = createConsentDecision(preferences);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsentCookie(
    decision,
  )}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  notifyConsentListeners();
  window.dispatchEvent(new CustomEvent<ConsentDecision>(CONSENT_EVENT, { detail: decision }));
  return decision;
}

/**
 * Client-side jurisdiction hint for marketing pages, which stay static and do
 * not receive a geo header. The server uses the deployment's real country
 * header for public analytics; this only selects the banner's wording and its
 * initial defaults.
 */
export function detectRestrictedJurisdiction(): boolean {
  if (typeof window === "undefined") return false;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  if (timezone.startsWith("Europe/") || timezone === "Atlantic/Canary") return true;

  const languages = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  return languages.some((language) => restrictedFromLanguage(language) === true);
}
