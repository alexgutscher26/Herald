import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Webhook signing and retry policy.
 *
 * Pure functions, unit-tested without a database. A delivery is signed over
 * `<unix timestamp>.<raw body>` so the receiver can reject a replayed body and
 * verify exactly the bytes it received. The timestamp window is deliberately
 * short; receivers should also deduplicate on the delivery id.
 */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const WEBHOOK_SIGNATURE_VERSION = "v1";
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** How long a rotated secret remains accepted while receivers deploy it. */
export const WEBHOOK_SECRET_OVERLAP_MS = 24 * 60 * 60 * 1000;

/**
 * Exponential base delays: 30s, 2m, 8m, 32m, 2h8m. The worker adds +/-20%
 * jitter so a provider outage cannot make every tenant retry in lockstep.
 */
export const WEBHOOK_RETRY_BASE_DELAY_MS = 30_000;
export const WEBHOOK_RETRY_MULTIPLIER = 4;
export const WEBHOOK_RETRY_JITTER_RATIO = 0.2;
export const WEBHOOK_MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
export const WEBHOOK_RETRY_DELAYS_MS = Array.from(
  { length: WEBHOOK_MAX_ATTEMPTS },
  (_, index) =>
    Math.min(
      WEBHOOK_RETRY_BASE_DELAY_MS * WEBHOOK_RETRY_MULTIPLIER ** index,
      WEBHOOK_MAX_RETRY_DELAY_MS,
    ),
);

export function createWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!/^\d{1,12}$/.test(input.timestamp)) return false;

  const timestamp = Number.parseInt(input.timestamp, 10);
  if (!Number.isSafeInteger(timestamp)) return false;

  const tolerance = input.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const expected = signWebhookPayload(input.secret, input.timestamp, input.body);
  const provided = Buffer.from(input.signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

export function nextAttemptDelayMs(attempt: number, random = Math.random()): number {
  const index = Math.min(
    Math.max(1, Math.trunc(attempt)),
    WEBHOOK_RETRY_DELAYS_MS.length,
  ) - 1;
  const base = Math.min(
    WEBHOOK_RETRY_BASE_DELAY_MS * WEBHOOK_RETRY_MULTIPLIER ** index,
    WEBHOOK_MAX_RETRY_DELAY_MS,
  );
  // Keep the backoff monotonic while spreading retries: a deterministic
  // caller can pass 0.5, production uses the platform RNG.
  const sample = Math.min(Math.max(random, 0), 1);
  const jitter = base * WEBHOOK_RETRY_JITTER_RATIO * (sample * 2 - 1);
  return Math.round(base + jitter);
}

export type WebhookUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  // IPv6 unique-local and link-local ranges.
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  return false;
}

/**
 * Validate a destination.
 *
 * Only absolute http(s) URLs without embedded credentials are accepted. Private
 * and loopback hosts are refused so a workspace cannot use a webhook to probe
 * the deployment's own network. DNS is deliberately not resolved here: a
 * hostname can still resolve to a private address (DNS rebinding), which a
 * production deployment **must** close with a filtering egress proxy.
 * `allowPrivate` is
 * only for local integration tests.
 */
export function validateWebhookUrl(
  raw: string,
  options: { allowPrivate?: boolean | undefined } = {},
): WebhookUrlValidation {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Use an absolute http(s) URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Use an absolute http(s) URL." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Do not put credentials in the webhook URL." };
  }
  if (url.hash) {
    return { ok: false, reason: "Remove the fragment from the webhook URL." };
  }
  if (!options.allowPrivate && isPrivateHostname(url.hostname)) {
    return {
      ok: false,
      reason: "Webhook URLs must use a public host, not localhost or a private address.",
    };
  }

  return { ok: true, url };
}
