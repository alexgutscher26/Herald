import { describe, expect, test } from "bun:test";

import {
  rateReading,
  thresholdReading,
  transitionFor,
} from "@/features/observability/rules";
import {
  buildBackupManifest,
  manifestChecksum,
} from "@/lib/observability/backup-manifest";
import {
  getAlertThresholds,
  getInternalAdminEmails,
  getRetentionSettings,
  isInternalAdminEmail,
} from "@/lib/observability/config";
import { estimateMonthlyCost } from "@/lib/observability/cost";
import { isDatabaseUnavailable } from "@/lib/observability/pool-errors";
import { getReleaseInfo, releaseTag, sanitizeRelease } from "@/lib/observability/release";
import { parseSentryDsn } from "@/lib/observability/sentry";

describe("release identity", () => {
  test("prefers RELEASE_VERSION and falls back to the commit, then dev", () => {
    expect(
      getReleaseInfo({ RELEASE_VERSION: "2026.11.21", NODE_ENV: "production" }),
    ).toEqual({
      release: "2026.11.21",
      environment: "production",
      commit: null,
    });

    expect(
      getReleaseInfo({
        VERCEL_GIT_COMMIT_SHA: "abc1234",
        VERCEL_ENV: "preview",
      }),
    ).toEqual({
      release: "abc1234",
      environment: "preview",
      commit: "abc1234",
    });

    expect(getReleaseInfo({})).toEqual({
      release: "dev",
      environment: "development",
      commit: null,
    });
  });

  test("rejects a release value that could break a tag or a URL", () => {
    expect(sanitizeRelease("v1.2.3+build.4")).toBe("v1.2.3+build.4");
    expect(sanitizeRelease("has space")).toBeNull();
    expect(sanitizeRelease("line\nbreak")).toBeNull();
    expect(sanitizeRelease("x".repeat(121))).toBeNull();
    expect(sanitizeRelease("")).toBeNull();
  });

  test("prefixes the app name on the tag", () => {
    expect(releaseTag({ release: "abc", environment: "production", commit: "abc" })).toBe(
      "herald@abc",
    );
  });
});

describe("Sentry DSN parsing", () => {
  test("derives the store endpoint and keeps the public key out of the path", () => {
    expect(parseSentryDsn("https://public-key@o0.ingest.sentry.io/12345")).toEqual({
      endpoint: "https://o0.ingest.sentry.io/api/12345/store/",
      publicKey: "public-key",
      projectId: "12345",
      origin: "https://o0.ingest.sentry.io",
    });
  });

  test("preserves a self-hosted path prefix", () => {
    expect(
      parseSentryDsn("https://key@errors.example.com/sentry/42")?.endpoint,
    ).toBe("https://errors.example.com/sentry/api/42/store/");
  });

  test("rejects malformed or non-http DSNs", () => {
    expect(parseSentryDsn(null)).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
    expect(parseSentryDsn("not a url")).toBeNull();
    expect(parseSentryDsn("ftp://key@example.com/42")).toBeNull();
    expect(parseSentryDsn("https://example.com/42")).toBeNull();
    expect(parseSentryDsn("https://key@example.com/not-a-project")).toBeNull();
  });
});

describe("database capacity classification", () => {
  test("recognises pool exhaustion by SQLSTATE and message", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("boom"), { code: "53300" }))).toBe(
      true,
    );
    expect(
      isDatabaseUnavailable(
        new Error("timeout exceeded when trying to connect"),
      ),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(
        new Error("connect failed", {
          cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
        }),
      ),
    ).toBe(true);
  });

  test("does not turn a query bug into a capacity incident", () => {
    expect(isDatabaseUnavailable(new Error('syntax error at or near "seelct"'))).toBe(
      false,
    );
    expect(
      isDatabaseUnavailable(
        Object.assign(new Error("duplicate key value"), { code: "23505" }),
      ),
    ).toBe(false);
    expect(isDatabaseUnavailable("not an error")).toBe(false);
  });
});

describe("internal admin allowlist", () => {
  test("normalises, deduplicates and ignores invalid addresses", () => {
    expect(
      getInternalAdminEmails({
        INTERNAL_ADMIN_EMAILS: " Ops@Example.com,ops@example.com, not-an-email,dev@example.com ",
      }),
    ).toEqual(["ops@example.com", "dev@example.com"]);
  });

  test("an empty list disables the surface", () => {
    expect(getInternalAdminEmails({})).toEqual([]);
    expect(isInternalAdminEmail("ops@example.com", {})).toBe(false);
    expect(
      isInternalAdminEmail("OPS@example.com", {
        INTERNAL_ADMIN_EMAILS: "ops@example.com",
      }),
    ).toBe(true);
    expect(
      isInternalAdminEmail("someone@example.com", {
        INTERNAL_ADMIN_EMAILS: "ops@example.com",
      }),
    ).toBe(false);
  });
});

describe("thresholds and retention are bounded", () => {
  test("defaults are the documented values", () => {
    const thresholds = getAlertThresholds({});
    expect(thresholds.errorRatePct).toBe(2);
    expect(thresholds.minRequests).toBe(20);
    expect(thresholds.queueDepth).toBe(50);
    expect(thresholds.aiDailyUsd).toBe(25);
    expect(thresholds.backupMaxAgeHours).toBe(26);
  });

  test("a typo cannot disable the guard rails", () => {
    const thresholds = getAlertThresholds({
      ALERT_5XX_RATE_PCT: "-5",
      ALERT_MIN_REQUESTS: "not-a-number",
      ALERT_QUEUE_DEPTH: "0",
      ALERT_BACKUP_MAX_AGE_HOURS: "99999",
    });
    expect(thresholds.errorRatePct).toBe(0);
    expect(thresholds.minRequests).toBe(20);
    expect(thresholds.queueDepth).toBe(1);
    expect(thresholds.backupMaxAgeHours).toBe(720);

    const retention = getRetentionSettings({
      REQUEST_METRICS_RETENTION_DAYS: "0",
      DASHBOARD_VIEW_RETENTION_DAYS: "-1",
    });
    expect(retention.requestMetricsDays).toBe(1);
    expect(retention.dashboardViewsDays).toBe(1);
  });
});

describe("cost estimates", () => {
  test("adds the four provider lines from usage and rates", () => {
    const estimate = estimateMonthlyCost({
      databaseBytes: 10 * 1024 ** 3,
      storageBytes: 100 * 1024 ** 3,
      emailsLast30Days: 1_000,
      aiCost30dUsd: 2.5,
      rates: { dbGbMonthUsd: 0.35, storageGbMonthUsd: 0.023, emailPer1000Usd: 1 },
    });

    expect(estimate.lineItems.map((item) => item.monthlyUsd)).toEqual([
      3.5, 2.3, 1, 2.5,
    ]);
    expect(estimate.totalMonthlyUsd).toBe(9.3);
  });

  test("an empty deployment still produces four zero lines", () => {
    const estimate = estimateMonthlyCost({
      databaseBytes: 0,
      storageBytes: 0,
      emailsLast30Days: 0,
      aiCost30dUsd: 0,
      rates: { dbGbMonthUsd: 0.35, storageGbMonthUsd: 0.023, emailPer1000Usd: 1 },
    });
    expect(estimate.lineItems).toHaveLength(4);
    expect(estimate.totalMonthlyUsd).toBe(0);
  });
});

function fixture(generatedAt: Date, objects = 12) {
  return buildBackupManifest({
    generatedAt,
    release: "test-release",
    migrations: 86,
    databaseBytes: 1024,
    counts: { workspaces: 3, feedback_posts: 9 },
    objects,
    bytes: objects * 100,
    attachmentsChecked: 5,
    attachmentsFailed: 0,
  });
}

describe("backup manifest", () => {
  test("is deterministic for the same input and hashes the exact bytes", () => {
    const first = fixture(new Date("2026-11-21T00:00:00.000Z"));
    const second = fixture(new Date("2026-11-21T00:00:00.000Z"));

    expect(first).toEqual(second);
    expect(first.storage.objects).toBe(12);
    expect(first.database.counts.workspaces).toBe(3);
    expect(first.database.migrations).toBe(86);

    const body = new TextEncoder().encode(JSON.stringify(first));
    const checksum = manifestChecksum(body);
    expect(checksum).toHaveLength(64);
    expect(manifestChecksum(body)).toBe(checksum);
    expect(manifestChecksum(new TextEncoder().encode(JSON.stringify(second)))).toBe(
      checksum,
    );
  });

  test("a changed manifest produces a different checksum", () => {
    const first = fixture(new Date("2026-11-21T00:00:00.000Z"));
    const changed = fixture(new Date("2026-11-21T00:00:00.000Z"), 13);
    expect(manifestChecksum(new TextEncoder().encode(JSON.stringify(first)))).not.toBe(
      manifestChecksum(new TextEncoder().encode(JSON.stringify(changed))),
    );
  });
});

describe("alert readings", () => {
  test("a rate below the minimum sample is healthy, not firing", () => {
    const reading = rateReading({
      rule: "http_5xx_rate",
      title: "HTTP 5xx rate",
      numerator: 3,
      denominator: 4,
      thresholdPct: 2,
      minSampleSize: 20,
      detail: (value) => `${value}%`,
    });
    expect(reading.state).toBe("ok");
    expect(reading.sampleSize).toBe(4);
    expect(reading.detail).toContain("below the 20-sample minimum");
  });

  test("a rate above the threshold with enough samples fires", () => {
    const reading = rateReading({
      rule: "http_5xx_rate",
      title: "HTTP 5xx rate",
      numerator: 4,
      denominator: 100,
      thresholdPct: 2,
      minSampleSize: 20,
      detail: (value) => `${value}%`,
    });
    expect(reading.state).toBe("firing");
    expect(reading.value).toBe(4);
  });

  test("an absolute threshold fires only above the value", () => {
    expect(
      thresholdReading({
        rule: "queue_depth",
        title: "Queue",
        value: 50,
        threshold: 50,
        unit: "count",
        detail: () => "",
      }).state,
    ).toBe("ok");
    expect(
      thresholdReading({
        rule: "queue_depth",
        title: "Queue",
        value: 51,
        threshold: 50,
        unit: "count",
        detail: () => "",
      }).state,
    ).toBe("firing");
  });

  test("transitions are explicit", () => {
    expect(transitionFor("ok", "firing")).toEqual({
      previous: "ok",
      next: "firing",
      changed: true,
    });
    expect(transitionFor("firing", "firing")).toEqual({
      previous: "firing",
      next: "firing",
      changed: false,
    });
  });
});
