/**
 * PII scrubbing for logs and error reports.
 *
 * Two independent rules run on every field:
 *
 *  - a key whose name looks like a credential is replaced outright;
 *  - a string value is scanned for email addresses, bearer tokens, JWTs,
 *    session cookies, secret query parameters, IP addresses, phone numbers and
 *    payment-card numbers, and each match is replaced.
 *
 * Scrubbing values as well as keys matters because the most common leak is a
 * provider error message or a URL that embeds an address or a reset token in
 * prose, not in a field called `token`.
 *
 * The module is intentionally dependency-free and runtime-neutral so the
 * logger, the proxy-safe request helpers and the test suite can all share it.
 */

export const REDACTED = "[redacted]";

/** Keys that must never reach a log line, matched case-insensitively. */
export const SENSITIVE_KEY =
  /(secret|token|password|passwd|authorization|cookie|api[-_]?key|signature|private[-_]?key|webhook|dsn|credential|otp|reset[-_]?token)/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_SECRET =
  /([?&](?:token|key|api_?key|secret|password|signature|code|auth|access_token|refresh_token|id_token)=)[^&\s#]*/gi;
const COOKIE_VALUE =
  /\b(herald_[a-z0-9_]*session|[a-z0-9_-]*session|session|csrf|xsrf)\s*=\s*[^;\s,]+/gi;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
/** Full-form and compressed IPv6; deliberately avoids clock-like `12:34:56`. */
const IPV6_FULL = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi;
const IPV6_COMPRESSED = /\b(?:[0-9a-f]{1,4}:){2,7}:(?:[0-9a-f]{1,4})\b/gi;
const PHONE = /(?:\+|00)\d{7,15}\b/g;
const LONG_DIGITS = /\b(?:\d[ -]?){13,19}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Replace PII patterns in one string. Never throws, never shortens. */
export function scrubText(input: string): string {
  if (input.length === 0) return input;

  let output = input
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(URL_SECRET, `$1${REDACTED}`)
    .replace(COOKIE_VALUE, (match) => {
      const name = match.split("=")[0]?.trim() ?? "session";
      return `${name}=${REDACTED}`;
    })
    .replace(IPV4, REDACTED)
    .replace(IPV6_FULL, REDACTED)
    .replace(IPV6_COMPRESSED, REDACTED)
    .replace(PHONE, REDACTED);

  output = output.replace(LONG_DIGITS, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return digits.length >= 13 && luhnValid(digits) ? REDACTED : match;
  });

  return output;
}

const MAX_DEPTH = 3;
const MAX_ARRAY = 20;

/**
 * Scrub a structured value.
 *
 * `seen` protects against a circular object graph, which would otherwise turn
 * a diagnostic log into a stack overflow. Functions and symbols are omitted
 * rather than stringified.
 */
export function scrubValue(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (depth >= MAX_DEPTH) return "[truncated]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubText(value.message),
    };
  }

  if (typeof value === "object") {
    const objects = (seen ??= new WeakSet<object>());
    if (objects.has(value)) return "[circular]";
    objects.add(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => scrubValue(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = REDACTED;
        continue;
      }
      const scrubbed = scrubValue(inner, depth + 1, seen);
      if (scrubbed !== undefined) output[key] = scrubbed;
    }
    return output;
  }

  return scrubText(String(value));
}
