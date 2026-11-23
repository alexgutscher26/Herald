"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ErrorState } from "@/components/shared/error-state";
import { buildSupportHref } from "@/lib/support-link";

/**
 * Public portal error boundary. The support form is part of the same portal, so
 * the prefilled link keeps the visitor in the product instead of a mail client.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  return (
    <main id="public-main" tabIndex={-1}>
      <ErrorState
        className="min-h-screen"
        code="Error"
        title="This page could not be loaded"
        description="An unexpected error occurred. Try again, and contact the team if it keeps happening."
        onRetry={reset}
        supportHref={buildSupportHref({ pathname, digest: error.digest })}
        statusHref="/status"
        reference={error.digest}
        footer={
          <Link className="text-primary hover:underline" href="/status/incidents">
            Service incidents
          </Link>
        }
      />
    </main>
  );
}
