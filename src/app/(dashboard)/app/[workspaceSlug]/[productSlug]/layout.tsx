import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { loadDashboardSnapshot } from "@/features/live/snapshot";
import { DashboardProvider } from "@/features/live/store";
import { requireProductContext } from "@/lib/authz";

/**
 * Product shell.
 *
 * Resolves session → membership → product inside that workspace, loads the
 * member's releases, feedback, roadmap links and cancellation reasons from
 * Postgres, and passes the serialisable snapshot into the client shell.
 * Server actions re-check authorization independently; this layout is not the
 * security boundary.
 */
export default async function ProductLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const context = await requireProductContext(workspaceSlug, productSlug);
  const snapshot = await loadDashboardSnapshot(context);

  return (
    <DashboardProvider initialState={snapshot}>
      <AppShell workspaceSlug={workspaceSlug} productSlug={productSlug}>
        {children}
      </AppShell>
    </DashboardProvider>
  );
}
