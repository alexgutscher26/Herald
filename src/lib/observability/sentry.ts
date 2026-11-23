/**
 * Sentry-compatible error ingestion.
 *
 * The application already speaks HTTP for every provider, so error tracking is
 * one more bounded POST rather than a vendor SDK. A standard Sentry DSN works
 * unchanged (Sentry SaaS, a self-hosted Sentry, or any relay that implements
 * the store endpoint). DSNs are parsed rather than interpolated so a malformed
 * value cannot post a key to an unexpected host.
 *
 * The event deliberately carries no request cookies, headers, query strings,
 * user identity or tenant identifiers. `buildSentryEvent` is exported so the
 * shape and the scrubbing rules are covered by unit tests.
 */

import { REDACTED, scrubText, scrubValue } from "./scrub";

export type SentryTarget = {
  /** Full store endpoint, including any self-hosted path prefix. */
  endpoint: string;
  publicKey: string;
  projectId: string;
  origin: string;
};

export function parseSentryDsn(raw: string | null | undefined): SentryTarget | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.username) return null;

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const projectId = segments.at(-1);
  if (!projectId || !/^\d+$/.test(projectId)) return null;

  const prefix = segments.slice(0, -1);
  const path = prefix.length > 0 ? `/${prefix.join("/")}` : "";
  const endpoint = `${url.origin}${path}/api/${projectId}/store/`;

  return {
    endpoint,
    publicKey: decodeURIComponent(url.username),
    projectId,
    origin: url.origin,
  };
}

export type SentryFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
};

/**
 * Server chunks are uploaded under `app:///_next/server/` because the absolute
 * build path differs per machine. Rewriting the frame to that artifact name is
 * what lets Sentry find the uploaded map and read the original source line.
 */
const SERVER_ARTIFACT_PREFIX = "app:///_next/server/";

function artifactFilename(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  const marker = "/.next/server/";
  const index = normalized.indexOf(marker);
  return index === -1
    ? file
    : SERVER_ARTIFACT_PREFIX + normalized.slice(index + marker.length);
}

/**
 * Turn a V8 stack into Sentry frames (oldest first).
 *
 * Only file/line/function are kept; the raw stack string can contain a URL
 * with a token, so it is never copied into `extra` as-is.
 */
export function parseStackFrames(stack: string | undefined): SentryFrame[] {
  if (!stack) return [];
  const frames: SentryFrame[] = [];

  for (const line of stack.split("\n").slice(0, 40)) {
    const match = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    const [, fn, file, lineNumber, column] = match;
    frames.push({
      filename: artifactFilename(scrubText(file ?? "")).slice(0, 300),
      ...(fn ? { function: scrubText(fn).slice(0, 200) } : {}),
      lineno: Number(lineNumber),
      colno: Number(column),
      in_app: !/node_modules|node:/.test(file ?? ""),
    });
  }

  return frames.reverse();
}

export type SentryEventInput = {
  event: string;
  error: { name: string; message: string; stack?: string };
  release: string;
  environment: string;
  requestId?: string | null;
  route?: string | null;
  fields?: Record<string, unknown>;
  occurredAt?: Date;
  fingerprint?: string[];
  debugImages?: Array<{ type: "sourcemap"; code_file: string; debug_id: string }>;
};

export type SentryEvent = Record<string, unknown> & {
  event_id: string;
  timestamp: string;
  platform: "node";
  level: "error";
  release: string;
  environment: string;
  tags: Record<string, string>;
  exception: { values: Array<Record<string, unknown>> };
  extra: Record<string, unknown>;
};

function eventId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

/**
 * Build the wire event.
 *
 * `fingerprint` groups occurrences by event name rather than by message, so a
 * changing id inside a message does not create a new issue per request.
 */
export function buildSentryEvent(input: SentryEventInput): SentryEvent {
  const occurredAt = input.occurredAt ?? new Date();
  const frames = parseStackFrames(input.error.stack);
  const scrubbedFields = (scrubValue(input.fields ?? {}) as Record<string, unknown>) ?? {};

  // Error events never carry a tenant identifier. The scrubber handles
  // credential-shaped keys; this removes workspace/product/customer ids that a
  // call site may have added for debugging.
  for (const key of Object.keys(scrubbedFields)) {
    if (/(workspace|tenant|customer|product).*id$/i.test(key)) {
      scrubbedFields[key] = REDACTED;
    }
  }

  const tags: Record<string, string> = {
    service: "herald",
    release: input.release,
    environment: input.environment,
  };
  if (input.route) tags.route = scrubText(input.route).slice(0, 120);
  if (input.requestId) tags.request_id = scrubText(input.requestId).slice(0, 128);

  const exceptionValue: Record<string, unknown> = {
    type: input.error.name.slice(0, 120),
    value: scrubText(input.error.message).slice(0, 2_000),
  };
  if (frames.length > 0) {
    exceptionValue.stacktrace = { frames };
  }

  return {
    event_id: eventId(),
    timestamp: occurredAt.toISOString(),
    platform: "node",
    level: "error",
    logger: "herald.observability",
    release: input.release,
    environment: input.environment,
    // Without these the collector cannot match a frame to its uploaded map.
    ...(input.debugImages?.length ? { debug_meta: { images: input.debugImages } } : {}),
    tags,
    fingerprint: input.fingerprint ?? [input.event, input.error.name],
    exception: { values: [exceptionValue] },
    extra: {
      event: input.event,
      ...scrubbedFields,
    },
    sdk: { name: "herald.observability", version: "1.0.0" },
  };
}

const TIMEOUT_MS = 3_000;

/** POST one event. Never throws; returns whether the collector accepted it. */
export async function sendSentryEvent(
  target: SentryTarget,
  event: SentryEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": [
          "Sentry sentry_version=7",
          `sentry_client=herald.observability/1.0.0`,
          `sentry_key=${target.publicKey}`,
        ].join(", "),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
