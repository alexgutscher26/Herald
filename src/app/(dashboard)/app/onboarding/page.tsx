import { Newspaper } from "lucide-react";

import { listWorkspaceSummaries } from "@/db/queries/workspaces";
import { OnboardingForm } from "@/features/onboarding/onboarding-form";
import { requireUser } from "@/lib/authz";

export const metadata = {
  title: "Set up your workspace",
};

/**
 * Minimal onboarding: create a workspace, its owner membership and the first
 * product, then land on the product dashboard. All three rows are written in
 * one transaction by the server action.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string }>;
}) {
  const params = await searchParams;
  const offerLifetime = params.offer === "lifetime";
  const user = await requireUser();
  const summaries = await listWorkspaceSummaries(user.id);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground"
          >
            <Newspaper className="size-3" />
          </span>
          Herald
        </span>
        <span className="text-xs text-muted-foreground">Signed in as {user.email}</span>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <div className="mb-8 space-y-1.5">
          <h1 className="[font-family:var(--font-archivo)] text-[26px] font-semibold leading-tight tracking-[-0.02em]">
            {summaries.length > 0 ? "Create another workspace" : "Set up your workspace"}
          </h1>
          <p className="text-sm text-muted-foreground">
            A workspace holds your team and products. You become its owner, and we will create
            your first product alongside it.
          </p>
        </div>

        <OnboardingForm
          existingWorkspaceCount={summaries.length}
          offerLifetime={offerLifetime}
        />
      </main>
    </div>
  );
}