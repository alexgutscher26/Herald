"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ErrorState } from "@/components/shared/error-state";
import { buildSupportHref } from "@/lib/support-link";

/**
 * Root error boundary.
 *
 * Shows a human sentence, a retry and a prefilled support route — never a stack
 * trace, driver message or request payload. A capacity failure in the database
 * pool surfaces here as the same friendly page as any other render error; the
 * API boundary returns a typed 503 for JSON clients.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  return (
    <main>
      <ErrorState
        className="min-h-screen"
        code="Error"
        title="This page could not be loaded"
        description="An unexpected error occurred. Try again, and contact support if it keeps happening."
        onRetry={reset}
        supportHref={buildSupportHref({ pathname, digest: error.digest })}
        statusHref="/status"
        reference={error.digest}
        footer={
          <Link className="text-primary hover:underline" href="/status/incidents">
            Incident runbook
          </Link>
        }
      />
    </main>
  );
}
