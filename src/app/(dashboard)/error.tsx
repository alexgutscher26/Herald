"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ErrorState } from "@/components/shared/error-state";
import { PermissionDeniedError } from "@/lib/permissions";
import { buildSupportHref } from "@/lib/support-link";

/**
 * Dashboard error boundary.
 *
 * A denied permission is rendered as an explicit 403 rather than silently
 * redirecting the user — hiding buttons and bouncing people to another route
 * is not authorization. Both variants use the shared error pattern, and the
 * support link already carries the route and error reference.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const digest = error.digest;
  const denied = error instanceof PermissionDeniedError;

  if (denied) {
    return (
      <ErrorState
        code="403"
        title="You do not have access to this"
        description={error.message}
        supportHref={buildSupportHref({
          pathname,
          digest,
          note: "I need access to this page. What I was doing:",
        })}
        backHref="/app"
        backLabel="Back to overview"
        reference={digest}
      />
    );
  }

  return (
    <ErrorState
      code="Error"
      title="This page could not be loaded"
      description="An unexpected error occurred. Try again, and contact support if it keeps happening."
      onRetry={reset}
      supportHref={buildSupportHref({
        pathname,
        digest,
        note: "What I was doing:",
      })}
      statusHref="/status"
      reference={digest}
      footer={
        <Link className="text-primary hover:underline" href="/status/incidents">
          Incident runbook
        </Link>
      }
    />
  );
}
