import type { ReactNode } from "react";

import { requireUser } from "@/lib/authz";

/**
 * Authenticated application segment.
 *
 * Every dashboard request requires a Better Auth session. This redirect is a
 * UX guard, never authorization: pages and actions call
 * `requireProductContext` themselves.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
