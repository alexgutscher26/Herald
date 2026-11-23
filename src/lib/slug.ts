/**
 * Slug generation and validation for workspace, product and release slugs.
 *
 * Slugs are used inside URLs, so they are restricted to a conservative ASCII
 * subset: lowercase letters, digits and single internal hyphens.
 */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;

/** Matches a slug we are willing to accept or store. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

/**
 * Path segments that would collide with application routes or static assets.
 * These are rejected regardless of validity.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "app",
  "api",
  "admin",
  "auth",
  "assets",
  "static",
  "health",
  "onboarding",
  "settings",
  "sign-in",
  "sign-up",
  "signout",
  "logout",
  "login",
  "register",
  "new",
  "edit",
  "delete",
  "null",
  "undefined",
];

/**
 * Turn arbitrary display text into a URL-safe slug.
 *
 * Non-ASCII characters are dropped rather than transliterated (no extra
 * dependency); if nothing usable remains the result is `""` and the caller
 * must ask the user for a value.
 */
export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");

  return slug;
}

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/** Validate a slug supplied by a user (never used to silently rewrite it). */
export function validateSlug(input: string): SlugValidation {
  const slug = input.trim();

  if (slug.length === 0) {
    return { ok: false, reason: "Slug is required." };
  }
  if (slug !== input) {
    return { ok: false, reason: "Slug must not contain leading or trailing whitespace." };
  }
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Slug must be between ${SLUG_MIN_LENGTH} and ${SLUG_MAX_LENGTH} characters.`,
    };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: "Slug may only contain lowercase letters, numbers and single hyphens, and must start and end with a letter or number.",
    };
  }
  if (slug.includes("--")) {
    return { ok: false, reason: "Slug must not contain consecutive hyphens." };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { ok: false, reason: `"${slug}" is reserved and cannot be used.` };
  }

  return { ok: true, slug };
}

/** True when `candidate` collides with an already-taken slug (case-insensitive). */
export function slugExists(candidate: string, taken: readonly string[]): boolean {
  const needle = candidate.trim().toLowerCase();
  return taken.some((value) => value.toLowerCase() === needle);
}