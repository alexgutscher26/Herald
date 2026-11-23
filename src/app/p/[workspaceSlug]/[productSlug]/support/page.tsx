import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicHeader } from "@/features/public/public-header";
import { getPublicViewerIdentity } from "@/features/public/viewer";
import { PortalSupportForm } from "@/features/portal/support-form";
import { loadPortalNavigation } from "@/features/portal/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Support" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortalSupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ subject?: string | string[]; body?: string | string[] }>;
}) {
  const resolved = await params;
  const query = await searchParams;
  const [page, viewer] = await Promise.all([
    loadPortalNavigation(resolved),
    getPublicViewerIdentity(resolved.workspaceSlug),
  ]);
  if (!page) notFound();

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader
        productName={page.productName}
        workspaceSlug={resolved.workspaceSlug}
        productSlug={resolved.productSlug}
        viewer={viewer}
        homeHref={page.productPath}
        nextPath={`${page.productPath}/support`}
      />
      <main id="public-main" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Support
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">How can we help?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Send a message to the {page.productName} team. A support conversation is created
          for this portal session, and you can follow replies in your notifications.
        </p>
        <div className="mt-6">
          <PortalSupportForm
            workspaceSlug={resolved.workspaceSlug}
            productSlug={resolved.productSlug}
            initialSubject={first(query.subject)}
            initialBody={first(query.body)}
          />
        </div>
      </main>
    </div>
  );
}
