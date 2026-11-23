import Link from "next/link";
import type { ReactNode } from "react";

/** Minimal centred frame for the sign-in and sign-up routes. */

// Both pages read the session cookie to bounce already-signed-in visitors,
// so this segment is always rendered per request.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 text-base font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            C
          </span>
          Herald
        </Link>
        {children}
      </div>
    </div>
  );
}