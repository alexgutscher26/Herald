/**
 * Cookie-consent data shared by the server and the browser.
 *
 * The decision is one first-party cookie. It stores only three booleans and a
 * timestamp: no identifier, no request metadata. Keeping the parser and the
 * jurisdiction list here means the banner and the server-side analytics gate
 * cannot disagree about what a stored value means.
 */

export const CONSENT_COOKIE = "herald_consent";
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const CONSENT_EVENT = "herald:consent";
export const CONSENT_OPEN_EVENT = "herald:open-consent";

export type ConsentPreferences = {
  analytics: boolean;
  embeds: boolean;
};

export type ConsentDecision = ConsentPreferences & {
  version: typeof CONSENT_VERSION;
  decidedAt: string;
};

/**
 * Jurisdictions where optional cookies need an affirmative choice. This is a
 * conservative list: the EU/EEA, the UK, Switzerland and the Crown dependencies
 * that apply the same model. It is not legal advice and an operator should
 * confirm the list for their own deployment.
 */
export const RESTRICTED_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "UK",
  "CH",
  "GG",
  "JE",
  "IM",
]);

const RESTRICTED_REGION = new RegExp(
  `[-_](?:${[...RESTRICTED_COUNTRIES].join("|")})\\b`,
  "i",
);

export function isRestrictedCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return RESTRICTED_COUNTRIES.has(country.trim().toUpperCase());
}

/**
 * Best-effort fallback when the deployment does not expose a geo header.
 * `en-GB,en;q=0.9` is a clear signal; an unqualified `en` is not.
 */
export function restrictedFromLanguage(
  acceptLanguage: string | null | undefined,
): boolean | null {
  if (!acceptLanguage) return null;
  const first = acceptLanguage.split(",")[0]?.trim();
  if (!first) return null;
  if (RESTRICTED_REGION.test(first)) return true;
  // A language tag without a region says nothing about jurisdiction.
  return /^[a-z]{2,3}[-_][a-z]{2,4}$/i.test(first) ? false : null;
}

/**
 * Restricted visitors start with optional storage off. Elsewhere analytics is
 * on by default (the banner still records an explicit decision), while embeds
 * always wait for a click or an "accept all".
 */
export function defaultPreferences(restricted: boolean): ConsentPreferences {
  return { analytics: !restricted, embeds: false };
}

export function parseConsentCookie(raw: string | null | undefined): ConsentDecision | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== CONSENT_VERSION) return null;
    if (typeof record.analytics !== "boolean" || typeof record.embeds !== "boolean") {
      return null;
    }
    if (typeof record.decidedAt !== "string" || record.decidedAt.length === 0) {
      return null;
    }
    return {
      version: CONSENT_VERSION,
      analytics: record.analytics,
      embeds: record.embeds,
      decidedAt: record.decidedAt,
    };
  } catch {
    return null;
  }
}

export function createConsentDecision(preferences: ConsentPreferences): ConsentDecision {
  return {
    version: CONSENT_VERSION,
    analytics: preferences.analytics,
    embeds: preferences.embeds,
    decidedAt: new Date().toISOString(),
  };
}

export function serializeConsentCookie(decision: ConsentDecision): string {
  return encodeURIComponent(JSON.stringify(decision));
}
