import "server-only";

import { cookies, headers } from "next/headers";

import {
  CONSENT_COOKIE,
  defaultPreferences,
  isRestrictedCountry,
  parseConsentCookie,
  restrictedFromLanguage,
  type ConsentDecision,
  type ConsentPreferences,
} from "./core";

export type ConsentState = {
  /** A stored choice exists; otherwise the values are defaults. */
  decided: boolean;
  restricted: boolean;
  preferences: ConsentPreferences;
  decision: ConsentDecision | null;
};

/**
 * Resolve the visitor's consent once per call.
 *
 * Cloudflare and Vercel expose the country as a header; when neither is
 * present we fall back to `Accept-Language`. If the jurisdiction is still
 * unknown the default is restrictive, so missing deployment configuration
 * cannot silently switch optional analytics on for a protected visitor.
 */
export async function getConsentState(): Promise<ConsentState> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const decision = parseConsentCookie(cookieStore.get(CONSENT_COOKIE)?.value);
  const country =
    headerStore.get("cf-ipcountry") ?? headerStore.get("x-vercel-ip-country");
  const restricted =
    isRestrictedCountry(country) ||
    (!country && (restrictedFromLanguage(headerStore.get("accept-language")) ?? true));

  return {
    decided: decision !== null,
    restricted,
    preferences: decision
      ? { analytics: decision.analytics, embeds: decision.embeds }
      : defaultPreferences(restricted),
    decision,
  };
}

/** The server-side gate for public view analytics. */
export async function analyticsAllowed(): Promise<boolean> {
  try {
    return (await getConsentState()).preferences.analytics;
  } catch {
    // Outside a request there is no visitor to measure, and failing closed is
    // the privacy-safe choice inside one.
    return false;
  }
}
