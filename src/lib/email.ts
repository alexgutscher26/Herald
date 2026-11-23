/**
 * One canonical email-normalization strategy for the whole application.
 *
 * Every place that compares, de-duplicates or scopes emails by product must
 * go through `normalizeEmail` — never compare raw addresses directly.
 *
 * The strategy is intentionally conservative:
 *   1. trim surrounding whitespace,
 *   2. lowercase the entire address.
 *
 * It deliberately does NOT strip dots or `+tags` from the local part, and does
 * not rewrite Gmail/Outlook aliases: those rules are provider-specific and
 * would merge addresses that are genuinely distinct for other providers.
 */

/** Trim + lowercase. Returns `""` for empty/whitespace-only input. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Minimal structural check: something@something.tld with no whitespace.
 * This is syntactic validation only — deliverability can only be proven by
 * sending mail, which is not part of this scaffold.
 */
export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;

  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  if (value.indexOf("@") !== at) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  if (!domain.includes(".")) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;

  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

/** The value stored in `<table>.emailNormalized` for a raw address. */
export function emailKey(email: string): string {
  return normalizeEmail(email);
}