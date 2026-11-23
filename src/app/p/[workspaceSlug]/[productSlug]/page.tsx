import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { trackPortalPageView } from "@/features/analytics/track";
import {
  PUBLIC_SECTION_LABEL_KEYS,
  formatPublicDate,
} from "@/features/public/i18n";
import { getPublicSite } from "@/features/public/i18n/server";
import { PublicHeader } from "@/features/public/public-header";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";
import { PortalOutboundBanner } from "@/features/portal/outbound-banner";
import { loadPortalHome } from "@/features/portal/service";

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await loadPortalHome({
    ...resolved,
    viewer: await getPublicViewer(),
  });
  if (!page) return { title: "Portal not found", robots: { index: false } };
  return {
    title: `${page.productName} — customer portal`,
    description: page.productDescription ?? `Help, feedback and updates for ${page.productName}.`,
  };
}

export default async function PublicPortalPage({ params }: { params: Promise<Params> }) {
  const resolved = await params;
  const [viewer, viewerIdentity, site] = await Promise.all([
    getPublicViewer(),
    getPublicViewerIdentity(resolved.workspaceSlug),
    getPublicSite(resolved.workspaceSlug),
  ]);
  const page = await loadPortalHome({ ...resolved, viewer, locale: site.locale });
  if (!page) notFound();
  const { t } = site;

  await trackPortalPageView({
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    page: "home",
  });
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader
        productName={page.productName}
        workspaceSlug={resolved.workspaceSlug}
        productSlug={resolved.productSlug}
        viewer={viewerIdentity}
        homeHref={page.productPath}
        nextPath={page.productPath}
      />
      <main id="public-main" tabIndex={-1} className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6">
        <section className="rounded-2xl border bg-card p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Customer portal
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {page.productName}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {page.productDescription?.trim() ||
              "Find answers, share feedback, follow the roadmap and see what shipped."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <Link
              href={`${page.productPath}/support`}
              className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
            >
              Contact support
            </Link>
            {page.sections.slice(0, 3).map((section) => (
              <Link
                key={section.key}
                href={section.href}
                className="rounded-md border px-3 py-2 font-medium hover:border-primary/40"
              >
                {t(PUBLIC_SECTION_LABEL_KEYS[section.key])}
              </Link>
            ))}
          </div>
          {page.shippedThisQuarter !== null ? (
            <p className="mt-4 inline-flex items-baseline gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-lg font-semibold tabular-nums">
                {page.shippedThisQuarter}
              </span>
              <span className="text-muted-foreground">
                thing{page.shippedThisQuarter === 1 ? "" : "s"} shipped this quarter
              </span>
            </p>
          ) : null}
        </section>

        {page.outbound.length > 0 ? (
          <PortalOutboundBanner
            workspaceSlug={resolved.workspaceSlug}
            productSlug={resolved.productSlug}
            message={page.outbound[0]!}
          />
        ) : null}

        {page.activeSurveys.length > 0 ? (
          <section aria-labelledby="portal-surveys">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="portal-surveys" className="text-lg font-semibold">Tell us what you think</h2>
              <span className="text-xs text-muted-foreground">Takes under a minute</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {page.activeSurveys.map((survey) => (
                <Link
                  key={survey.id}
                  href={`${page.productPath}/surveys/${survey.slug}`}
                  className="rounded-lg border bg-card p-4 hover:border-primary/40"
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{survey.kind}</p>
                  <p className="mt-1 font-medium">{survey.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Answer a few questions →</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {page.helpCollections.length > 0 ? (
          <section aria-labelledby="portal-help">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="portal-help" className="text-lg font-semibold">Help center</h2>
              <Link href={`${page.productPath}/help`} className="text-xs font-medium text-primary hover:underline">
                Browse all
              </Link>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {page.helpCollections.slice(0, 6).map((collection) => (
                <Link
                  key={collection.id}
                  href={`${page.productPath}/help/${collection.slug}`}
                  className="rounded-lg border bg-card p-4 hover:border-primary/40"
                >
                  <p className="font-medium">{collection.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {collection.description || `${collection.articleCount} article${collection.articleCount === 1 ? "" : "s"}`}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {page.boards.length > 0 ? (
          <section aria-labelledby="portal-feedback">
            <h2 id="portal-feedback" className="text-lg font-semibold">Feedback boards</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {page.boards.map((board) => (
                <Link
                  key={board.id}
                  href={`${page.productPath}/${board.slug}`}
                  className="rounded-lg border bg-card p-4 hover:border-primary/40"
                >
                  <p className="font-medium">{board.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{board.requestCount} requests</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {page.latestUpdates.length > 0 ? (
          <section aria-labelledby="portal-updates">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="portal-updates" className="text-lg font-semibold">Latest updates</h2>
              <Link href={`${page.productPath}/updates`} className="text-xs font-medium text-primary hover:underline">
                View changelog
              </Link>
            </div>
            <div className="mt-3 space-y-2">
              {page.latestUpdates.map((update) => (
                <Link
                  key={update.id}
                  href={`${page.productPath}/updates/${update.slug}`}
                  className="block rounded-lg border bg-card p-4 hover:border-primary/40"
                >
                  <p className="text-xs text-muted-foreground">{formatPublicDate(site.locale, update.publishedAt)}</p>
                  <p className="mt-1 font-medium">{update.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{update.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {viewer ? (
          <p className="border-t pt-5 text-xs text-muted-foreground">
            Signed in{viewerIdentity?.name ? ` as ${viewerIdentity.name}` : ""}.{" "}
            <Link href={`${page.productPath}/notifications`} className="underline">
              Open your notifications
            </Link>
            .
          </p>
        ) : null}
      </main>
    </div>
  );
}
