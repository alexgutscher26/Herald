import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicSite } from "@/features/public/i18n/server";
import { EmailPreferencesForm } from "@/features/subscribers/preferences-form";
import { getSubscriberPreferences } from "@/features/subscribers/preferences";

/**
 * Email preferences.
 *
 * The link in a product-update email carries a random token; that token is the
 * only credential. There is no sign-in and no other account data on the page.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const site = await getPublicSite(workspaceSlug);
  return {
    title: site.t("preferences.title"),
    robots: { index: false, follow: false },
  };
}

type Params = { workspaceSlug: string; productSlug: string };
type Search = { token?: string | string[] };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function EmailPreferencesPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const site = await getPublicSite(workspaceSlug);
  const { t } = site;
  const token = first((await searchParams).token).trim();
  const preferences = token ? await getSubscriberPreferences(token) : null;

  if (!preferences) {
    return (
      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6"
      >
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("preferences.invalidTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("preferences.invalidBody")}
        </p>
      </main>
    );
  }

  if (
    preferences.workspace.slug !== workspaceSlug ||
    preferences.product.slug !== productSlug
  ) {
    notFound();
  }

  return (
    <main
      id="public-main"
      tabIndex={-1}
      className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {preferences.workspace.name} · {preferences.product.name}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {t("preferences.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("preferences.forEmail", { email: preferences.email })}
      </p>

      <div className="mt-6 rounded-lg border bg-card p-5">
        <EmailPreferencesForm
          token={token}
          productName={preferences.product.name}
          workspaceName={preferences.workspace.name}
          initial={{
            topics: preferences.topics,
            notifyStatusChanges: preferences.notifyStatusChanges,
            notifyReplies: preferences.notifyReplies,
            digestFrequency: preferences.digestFrequency,
            quietHours: preferences.quietHours,
          }}
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {t("preferences.privacy")}
      </p>
    </main>
  );
}
