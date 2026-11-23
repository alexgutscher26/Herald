import { NextResponse } from "next/server";

import { getReadinessReport } from "@/features/status/checks";
import { getReleaseInfo } from "@/lib/observability/release";

/**
 * Health endpoint.
 *
 * Two genuinely different answers:
 *
 *  - `/api/health`           liveness. Is the process serving requests?
 *                            Never touches the database, never reads secrets,
 *                            never claims anything about dependencies.
 *  - `/api/health?scope=readiness`
 *                            readiness. Performs an actual `SELECT 1` and
 *                            reports only `ok` / `unavailable` — no driver
 *                            messages, hostnames or configuration values.
 *
 * Nothing here exposes environment variables, connection strings or internal
 * build details.
 */

export const dynamic = "force-dynamic";

type Scope = "liveness" | "readiness";

function parseScope(request: Request): Scope {
  const url = new URL(request.url);
  return url.searchParams.get("scope") === "readiness" ? "readiness" : "liveness";
}

export async function GET(request: Request): Promise<NextResponse> {
  const scope = parseScope(request);
  const timestamp = new Date().toISOString();
  const release = getReleaseInfo();

  if (scope === "liveness") {
    return NextResponse.json(
      {
        status: "ok",
        scope: "liveness",
        timestamp,
        release: release.release,
        environment: release.environment,
        // Explicitly unknown: liveness does not test dependencies.
        dependencies: {
          database: "unchecked",
          storage: "unchecked",
          email: "unchecked",
          backups: "unchecked",
          queue: "unchecked",
        },
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const report = await getReadinessReport();

  return NextResponse.json(
    {
      status: report.ready ? "ok" : "unavailable",
      scope: "readiness",
      timestamp,
      release: release.release,
      environment: release.environment,
      dependencies: {
        database: report.database,
        storage: report.storage,
        email: report.email,
        backups: report.backups,
        queue: report.queue,
      },
    },
    {
      status: report.ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}