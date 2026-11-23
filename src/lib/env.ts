import { z } from "zod";

import { normalizeSslMode } from "@/db/connection-string";
import { parseSentryDsn } from "@/lib/observability/sentry";

/**
 * Server-side environment schema.
 *
 * Validation is deliberately lazy: `getServerEnv()` runs on first use rather
 * than at module evaluation. Next.js evaluates route and layout modules while
 * building, so throwing at import time would turn a missing local variable
 * into a build failure instead of a clear runtime error at the call site.
 *
 * Nothing here is ever exposed to the browser: none of these names are
 * prefixed with `NEXT_PUBLIC_`.
 */

const isUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const serverSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL must not be empty")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    }),
  BETTER_AUTH_SECRET: z
    .string()
    .min(1, "BETTER_AUTH_SECRET must not be empty")
    .refine((v) => v.length >= 32, {
      message: "BETTER_AUTH_SECRET must be at least 32 characters",
    }),
  BETTER_AUTH_URL: z
    .string()
    .min(1, "BETTER_AUTH_URL must not be empty")
    .refine(isUrl, { message: "BETTER_AUTH_URL must be an absolute http(s) origin" }),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Test-only: drop the parsed environment.
 *
 * The integration harness gives each file its own `BETTER_AUTH_URL` and
 * database, but this module parses once for the whole process. Without a
 * reset, the first file's values leak into every later file and a same-origin
 * or database assertion fails for a reason unrelated to the code under test.
 */
export function resetServerEnvCache(): void {
  cached = null;
  cachedDbUrl = null;
}

/**
 * Read and validate the server-side environment.
 *
 * @throws a descriptive error naming every offending variable when the
 * configuration is missing or malformed, so failures surface at the point the
 * affected functionality is actually invoked.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const candidate = {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  };

  const result = serverSchema.safeParse(candidate);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid server environment configuration — ${details}. ` +
        `Copy .env.example to .env and fill in the required values (see README.md).`,
    );
  }

  cached = result.data;
  return cached;
}

/** True only for `NODE_ENV=production`. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

const cronSecretSchema = z
  .string()
  .min(24, "CRON_SECRET must be at least 24 characters");

/**
 * Shared secret for the scheduled-release endpoint.
 *
 * Returns `null` when unset, which keeps the endpoint switched off instead of
 * open. A malformed value throws rather than silently disabling the job.
 */
export function getCronSecret(): string | null {
  const raw = process.env.CRON_SECRET;
  if (raw === undefined || raw.trim() === "") return null;

  const result = cronSecretSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid server environment configuration — ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const emailSchema = z.object({
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY must not be empty"),
  EMAIL_FROM: z
    .string()
    .min(3, "EMAIL_FROM must not be empty")
    .refine((value) => value.includes("@"), {
      message: "EMAIL_FROM must contain an email address, e.g. Herald <updates@example.com>",
    }),
  /** Optional endpoint override; defaults to Resend's send URL. */
  EMAIL_API_URL: z
    .string()
    .refine(isUrl, { message: "EMAIL_API_URL must be an absolute http(s) URL" })
    .optional(),
});

export type EmailConfig = z.infer<typeof emailSchema>;

/**
 * Outbound email configuration.
 *
 * Returns `null` when neither variable is set, which keeps email disabled
 * instead of half-configured. Setting only one of the pair is a configuration
 * error and throws rather than silently switching sending off.
 */
export function getEmailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  if (apiKey === "" && from === "") return null;

  const endpoint = process.env.EMAIL_API_URL?.trim() ?? "";
  const result = emailSchema.safeParse({
    RESEND_API_KEY: apiKey,
    EMAIL_FROM: from,
    EMAIL_API_URL: endpoint === "" ? undefined : endpoint,
  });
  if (!result.success) {
    throw new Error(
      `Invalid email configuration — ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const imageTextSchema = z.object({
  OCR_API_URL: z
    .string()
    .min(1)
    .refine(isUrl, { message: "OCR_API_URL must be an absolute http(s) URL" }),
  OCR_API_KEY: z.string().min(1).optional(),
});

export type ImageTextConfig = z.infer<typeof imageTextSchema>;

/**
 * Optional image-text provider used by moderation.
 *
 * The contract is a multipart POST with a `file` part and a JSON response of
 * the form `{ "text": "..." }`. Without this configuration, image checks are
 * reported as unavailable and retryable — never as a pass.
 */
export function getImageTextConfig(): ImageTextConfig | null {
  const url = process.env.OCR_API_URL?.trim() ?? "";
  const apiKey = process.env.OCR_API_KEY?.trim() ?? "";
  if (url === "") {
    if (apiKey !== "") {
      throw new Error(
        "Invalid image-text configuration — OCR_API_KEY is set without OCR_API_URL.",
      );
    }
    return null;
  }

  const result = imageTextSchema.safeParse({
    OCR_API_URL: url,
    OCR_API_KEY: apiKey === "" ? undefined : apiKey,
  });
  if (!result.success) {
    throw new Error(
      `Invalid image-text configuration — ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const aiSchema = z.object({
  AI_API_URL: z
    .string()
    .min(1, "AI_API_URL must not be empty")
    .refine(isUrl, { message: "AI_API_URL must be an absolute http(s) URL" }),
  /** Optional for loopback OpenAI-compatible servers that do not require auth. */
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z
    .string()
    .trim()
    .min(1, "AI_MODEL must not be empty")
    .max(120, "AI_MODEL must be at most 120 characters"),
  /** Request ceiling; a stalled provider must become a handoff, not a hang. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(50).max(120_000).optional(),
});

export type AiConfig = z.infer<typeof aiSchema>;

/**
 * Optional OpenAI-compatible chat-completions configuration.
 *
 * Returns `null` when none of the three variables are set, which keeps AI
 * drafting switched off instead of failing on every release page. A partial
 * configuration throws, because a URL without a model (or a key without a URL)
 * would otherwise fail later with a much less useful provider error. The API
 * key is optional so a local OpenAI-compatible server can run without auth.
 */
export function getAiConfig(): AiConfig | null {
  const url = process.env.AI_API_URL?.trim() ?? "";
  const key = process.env.AI_API_KEY?.trim() ?? "";
  const model = process.env.AI_MODEL?.trim() ?? "";
  const timeout = process.env.AI_TIMEOUT_MS?.trim() ?? "";
  if (url === "" && key === "" && model === "") return null;

  const result = aiSchema.safeParse({
    AI_API_URL: url,
    AI_API_KEY: key === "" ? undefined : key,
    AI_MODEL: model,
    AI_TIMEOUT_MS: timeout === "" ? undefined : timeout,
  });
  if (!result.success) {
    throw new Error(
      `Invalid AI configuration — ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const aiEmbeddingSchema = z.object({
  AI_API_URL: z
    .string()
    .min(1, "AI_API_URL must not be empty")
    .refine(isUrl, { message: "AI_API_URL must be an absolute http(s) URL" }),
  AI_API_KEY: z.string().min(1).optional(),
  AI_EMBEDDING_MODEL: z.string().trim().min(1).max(120),
});

export type AiEmbeddingConfig = z.infer<typeof aiEmbeddingSchema>;

/**
 * Optional embedding endpoint, sharing the chat provider's base URL and key.
 *
 * Returns `null` when no embedding model is configured, in which case ingestion
 * uses the deterministic local embedding instead of silently sending document
 * text to a provider that was never asked to receive it.
 */
export function getAiEmbeddingConfig(): AiEmbeddingConfig | null {
  const url = process.env.AI_API_URL?.trim() ?? "";
  const model = process.env.AI_EMBEDDING_MODEL?.trim() ?? "";
  if (url === "" || model === "") return null;

  const result = aiEmbeddingSchema.safeParse({
    AI_API_URL: url,
    AI_API_KEY: process.env.AI_API_KEY?.trim() || undefined,
    AI_EMBEDDING_MODEL: model,
  });
  if (!result.success) {
    throw new Error(
      `Invalid embedding configuration — ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const errorWebhookSchema = z.string().min(1).refine(isUrl, {
  message: "ERROR_WEBHOOK_URL must be an absolute http(s) URL",
});

/**
 * Optional endpoint that receives reported errors.
 *
 * Returns `null` when unset, which keeps reporting log-only. A malformed value
 * throws instead of silently dropping errors.
 */
export function getErrorWebhookUrl(): string | null {
  const raw = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!raw) return null;

  const result = errorWebhookSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid error reporting configuration — ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const sentryDsnSchema = z.string().min(1).refine((value) => parseSentryDsn(value) !== null, {
  message:
    "SENTRY_DSN must be a Sentry DSN, e.g. https://KEY@o0.ingest.sentry.io/PROJECT_ID",
});

/**
 * Optional Sentry-compatible collector.
 *
 * Unset keeps reporting on the structured log and `ERROR_WEBHOOK_URL`. A
 * malformed DSN throws when an error is actually reported instead of silently
 * dropping events.
 */
export function getSentryDsn(): string | null {
  const raw = process.env.SENTRY_DSN?.trim();
  if (!raw) return null;

  const result = sentryDsnSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid observability configuration — ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}.`,
    );
  }
  return result.data;
}

/**
 * Alert channel.
 *
 * `ALERT_WEBHOOK_URL` is separate from the error channel because alert rules
 * fire on aggregate thresholds while `ERROR_WEBHOOK_URL` carries individual
 * exceptions. When it is unset the error channel is reused, so a deployment
 * that already has one channel still receives alerts.
 */
export function getAlertWebhookUrl(): string | null {
  const raw = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!raw) return getErrorWebhookUrl();

  const result = errorWebhookSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid alerting configuration — ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}.`,
    );
  }
  return result.data;
}

const idempotencyTtlSchema = z.coerce
  .number()
  .int("API_IDEMPOTENCY_TTL_HOURS must be a whole number of hours")
  .min(1, "API_IDEMPOTENCY_TTL_HOURS must be at least 1")
  .max(168, "API_IDEMPOTENCY_TTL_HOURS must be at most 168");

/**
 * How long a successful `Idempotency-Key` response is replayable.
 *
 * Defaults to 24 hours. A deployment can shorten it to reduce storage or
 * lengthen it to cover a longer client retry window, up to seven days. The
 * value is read per call so a restart is the only thing needed to change it.
 */
export function getApiIdempotencyTtlHours(): number {
  const raw = process.env.API_IDEMPOTENCY_TTL_HOURS?.trim();
  if (raw === undefined || raw === "") return 24;

  const result = idempotencyTtlSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid API idempotency configuration — ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}.`,
    );
  }
  return result.data;
}

/** The configured TTL in milliseconds, for row expiry timestamps. */
export function getApiIdempotencyTtlMs(): number {
  return getApiIdempotencyTtlHours() * 60 * 60 * 1000;
}

const databaseUrlSchema = serverSchema.shape.DATABASE_URL;

let cachedDbUrl: string | null = null;

/**
 * Validate and return only `DATABASE_URL`.
 *
 * Scripts that talk to the database (`db:migrate`, `db:studio`, the health
 * readiness probe) must not require authentication configuration that they
 * never use, so this reads the connection string on its own.
 *
 * Legacy `sslmode` aliases are rewritten to `verify-full` — the mode `pg`
 * already applies to them — so the driver's upgrade warning never reaches the
 * console. See `src/db/connection-string.ts`.
 *
 * @throws a descriptive error naming the offending variable.
 */
export function getDatabaseUrl(): string {
  if (cachedDbUrl) return cachedDbUrl;

  const result = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "DATABASE_URL"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid database configuration — ${details}. ` +
        `Copy .env.example to .env and set DATABASE_URL (see README.md).`,
    );
  }

  cachedDbUrl = normalizeSslMode(result.data);
  return cachedDbUrl;
}

const postHogSchema = z.object({
  apiKey: z.string().min(1, "POSTHOG_API_KEY must not be empty"),
  host: z
    .string()
    .min(1, "POSTHOG_HOST must not be empty")
    .refine(isUrl, { message: "POSTHOG_HOST must be an absolute http(s) URL" }),
});

export type PostHogConfig = z.infer<typeof postHogSchema>;

/**
 * Optional PostHog ingestion.
 *
 * Capture is server-side only, so this key never reaches a browser. Returns
 * `null` when `POSTHOG_API_KEY` is unset, which keeps every capture a no-op; a
 * malformed host throws when analytics is actually recorded instead of
 * silently dropping events.
 */
export function getPostHogConfig(): PostHogConfig | null {
  const apiKey = process.env.POSTHOG_API_KEY?.trim() ?? "";
  if (apiKey === "") return null;

  const result = postHogSchema.safeParse({
    apiKey,
    host: process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
  });
  if (!result.success) {
    throw new Error(
      `Invalid analytics configuration — ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}.`,
    );
  }
  return result.data;
}
