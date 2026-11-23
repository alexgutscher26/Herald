/**
 * Release identity for error events, traces and logs.
 *
 * A release tag is only useful when the deploy and the source-map upload agree
 * on it. `RELEASE_VERSION` is the explicit knob; on Vercel the commit SHA is a
 * stable fallback. `package.json` is never read at request time, so this stays
 * cheap and runtime-neutral.
 */

export type ReleaseInfo = {
  /** Sanitised identifier sent as the collector's `release` tag. */
  release: string;
  /** `production`, `preview`, `staging`, `development`, ... */
  environment: string;
  /** Full commit SHA when the deployment exposes one. */
  commit: string | null;
};

const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,119}$/;

export function sanitizeRelease(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  return SAFE_RELEASE.test(candidate) ? candidate : null;
}

export function getReleaseInfo(env: Record<string, string | undefined> = process.env): ReleaseInfo {
  const commit =
    sanitizeRelease(env.VERCEL_GIT_COMMIT_SHA) ??
    sanitizeRelease(env.GIT_COMMIT_SHA) ??
    null;
  const release =
    sanitizeRelease(env.RELEASE_VERSION) ?? commit ?? "dev";
  const environment =
    sanitizeRelease(env.SENTRY_ENVIRONMENT) ??
    sanitizeRelease(env.VERCEL_ENV) ??
    sanitizeRelease(env.NODE_ENV) ??
    "development";

  return { release, environment, commit };
}

/** The release plus a stable app prefix, e.g. `herald@2026.11.21`. */
export function releaseTag(info: ReleaseInfo = getReleaseInfo()): string {
  return `herald@${info.release}`;
}
