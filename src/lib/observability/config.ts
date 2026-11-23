/**
 * Observability configuration.
 *
 * Every value is read on demand and clamped, so a typo cannot disable an alert
 * or turn a slow-route warning into one line per request. Nothing here imports
 * `server-only`: the parsers are unit-tested with an explicit env object.
 */

function boundedNumber(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function boundedInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.trunc(boundedNumber(env, name, fallback, min, max));
}

function flag(env: Record<string, string | undefined>, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

export type ObservabilitySettings = {
  slowRouteMs: number;
  slowSpanMs: number;
  logEverySpan: boolean;
};

export function getObservabilitySettings(
  env: Record<string, string | undefined> = process.env,
): ObservabilitySettings {
  return {
    slowRouteMs: boundedInt(env, "SLOW_ROUTE_MS", 1_000, 50, 60_000),
    slowSpanMs: boundedInt(env, "SLOW_SPAN_MS", 750, 50, 60_000),
    logEverySpan: flag(env, "TRACE_LOG_ALL"),
  };
}

export type AlertThresholds = {
  /** Percentage, 0–100. */
  errorRatePct: number;
  minRequests: number;
  jobFailureRatePct: number;
  minJobClaims: number;
  queueDepth: number;
  queueAgeMinutes: number;
  emailBounceRatePct: number;
  minDeliveries: number;
  webhookFailureRatePct: number;
  minWebhookAttempts: number;
  aiDailyUsd: number;
  backupMaxAgeHours: number;
};

export function getAlertThresholds(
  env: Record<string, string | undefined> = process.env,
): AlertThresholds {
  return {
    errorRatePct: boundedNumber(env, "ALERT_5XX_RATE_PCT", 2, 0, 100),
    minRequests: boundedInt(env, "ALERT_MIN_REQUESTS", 20, 1, 10_000),
    jobFailureRatePct: boundedNumber(env, "ALERT_JOB_FAILURE_RATE_PCT", 10, 0, 100),
    minJobClaims: boundedInt(env, "ALERT_MIN_JOB_CLAIMS", 5, 1, 10_000),
    queueDepth: boundedInt(env, "ALERT_QUEUE_DEPTH", 50, 1, 1_000_000),
    queueAgeMinutes: boundedInt(env, "ALERT_QUEUE_AGE_MINUTES", 10, 1, 1_440),
    emailBounceRatePct: boundedNumber(env, "ALERT_EMAIL_BOUNCE_RATE_PCT", 2, 0, 100),
    minDeliveries: boundedInt(env, "ALERT_MIN_DELIVERIES", 20, 1, 10_000),
    webhookFailureRatePct: boundedNumber(env, "ALERT_WEBHOOK_FAILURE_RATE_PCT", 5, 0, 100),
    minWebhookAttempts: boundedInt(env, "ALERT_MIN_WEBHOOK_ATTEMPTS", 20, 1, 10_000),
    aiDailyUsd: boundedNumber(env, "ALERT_AI_DAILY_USD", 25, 0, 1_000_000),
    backupMaxAgeHours: boundedInt(env, "ALERT_BACKUP_MAX_AGE_HOURS", 26, 1, 720),
  };
}

export type AiPricing = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
};

export function getAiPricing(
  env: Record<string, string | undefined> = process.env,
): AiPricing {
  return {
    inputUsdPerMTok: boundedNumber(env, "AI_INPUT_USD_PER_MTOK", 0.5, 0, 10_000),
    outputUsdPerMTok: boundedNumber(env, "AI_OUTPUT_USD_PER_MTOK", 1.5, 0, 10_000),
  };
}

export type CostRates = {
  dbGbMonthUsd: number;
  storageGbMonthUsd: number;
  emailPer1000Usd: number;
};

export function getCostRates(
  env: Record<string, string | undefined> = process.env,
): CostRates {
  return {
    dbGbMonthUsd: boundedNumber(env, "COST_DB_GB_MONTH_USD", 0.35, 0, 1_000),
    storageGbMonthUsd: boundedNumber(env, "COST_STORAGE_GB_MONTH_USD", 0.023, 0, 1_000),
    emailPer1000Usd: boundedNumber(env, "COST_EMAIL_PER_1000_USD", 1, 0, 1_000),
  };
}

export type RetentionSettings = {
  requestMetricsDays: number;
  dashboardViewsDays: number;
  aiUsageDays: number;
  backupVerificationsDays: number;
  backupManifestsDays: number;
};

export function getRetentionSettings(
  env: Record<string, string | undefined> = process.env,
): RetentionSettings {
  return {
    requestMetricsDays: boundedInt(env, "REQUEST_METRICS_RETENTION_DAYS", 7, 1, 365),
    dashboardViewsDays: boundedInt(env, "DASHBOARD_VIEW_RETENTION_DAYS", 180, 1, 730),
    aiUsageDays: boundedInt(env, "AI_USAGE_RETENTION_DAYS", 400, 1, 1_460),
    backupVerificationsDays: boundedInt(env, "BACKUP_VERIFICATION_RETENTION_DAYS", 90, 7, 730),
    backupManifestsDays: boundedInt(env, "BACKUP_MANIFEST_RETENTION_DAYS", 35, 7, 365),
  };
}

const ADMIN_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Internal operator allowlist.
 *
 * This is intentionally an environment allowlist rather than a workspace role:
 * a customer-side admin must never see deployment-wide tenant counts. An empty
 * list disables the surface entirely (the page answers 404).
 */
export function getInternalAdminEmails(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const raw = env.INTERNAL_ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => ADMIN_EMAIL.test(value)),
    ),
  ];
}

export function isInternalAdminEmail(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return getInternalAdminEmails(env).includes(normalized);
}
