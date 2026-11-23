/**
 * `pg` pool sizing.
 *
 * One pool exists per application process. On a serverless deployment every
 * concurrent instance builds its own, so the cluster-wide connection count is
 * `instances × max`. The Neon pooled (`-pooler`) endpoint multiplexes those
 * server connections; keep the product comfortably below the plan's pooled
 * limit, because migrations, jobs and the readiness probe also connect.
 *
 * Defaults deliberately stay small: ten connections is enough for a warm
 * instance serving the measured surfaces, and a smaller number is the only knob
 * that fixes "too many connections" without a provider change.
 */
export type PoolSettings = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  application_name: string;
};

export const DEFAULT_POOL_MAX = 10;
export const MAX_POOL_MAX = 50;
export const POOL_IDLE_TIMEOUT_MS = 30_000;
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;
export const POOL_APPLICATION_NAME = "herald-app";

function parseBounded(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

export function readPoolMax(
  env: Record<string, string | undefined> = process.env,
): number {
  return parseBounded(env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX, MAX_POOL_MAX);
}

export function poolSettings(
  env: Record<string, string | undefined> = process.env,
): PoolSettings {
  return {
    max: readPoolMax(env),
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    application_name: POOL_APPLICATION_NAME,
  };
}
