import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicHeader } from "@/features/public/public-header";
import { PUBLIC_SECTION_LABEL_KEYS } from "@/features/public/i18n";
import { getPublicViewer, getPublicViewerIdentity } from "@/features/public/viewer";
import { getPublicSite } from "@/features/public/i18n/server";
import { searchPortal } from "@/features/portal/service";

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string };

/**
 * Query pages are never indexed. The page is useful to the visitor and the
 * links from it remain followable, but a crawler should not create a result
 * page for every phrase typed into the box.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { workspaceSlug, productSlug } = await params;
  return {
    title: "Search",
    robots: { index: false, follow: true },
    alternates: { canonical: `/p/${workspaceSlug}/${productSlug}/search` },
  };
}

export default async function PortalSearchPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ q?: string }>;
}) {
  const resolved = await params;
  const query = await searchParams;
  const [viewer, publicViewer, site] = await Promise.all([
    getPublicViewerIdentity(resolved.workspaceSlug),
    getPublicViewer(),
    getPublicSite(resolved.workspaceSlug),
  ]);
  const page = await searchPortal({
    ...resolved,
    query: query.q ?? "",
    viewerCustomerId: publicViewer?.customerId ?? null,
    locale: site.locale,
  });
  if (!page) notFound();
  const productPath = `/p/${resolved.workspaceSlug}/${resolved.productSlug}`;
  const q = page.query;
  const { t } = site;

  const suggestions = (
    <section
      aria-labelledby="search-suggestions"
      className="mt-8 rounded-lg border bg-muted/20 p-5"
    >
      <h2 id="search-suggestions" className="text-sm font-semibold">
        {t("search.suggestionsTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("search.suggestionsBody")}</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {page.navigation.sections.map((section) => (
          <li key={section.key}>
            <Link href={section.href} className="text-primary underline-offset-2 hover:underline">
              {t(PUBLIC_SECTION_LABEL_KEYS[section.key])}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader
        productName={page.productName}
        workspaceSlug={resolved.workspaceSlug}
        productSlug={resolved.productSlug}
        viewer={viewer}
        homeHref={productPath}
        nextPath={`${productPath}/search?q=${encodeURIComponent(q)}`}
      />
      <main id="public-main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("search.title")}</h1>
        <form action={`${productPath}/search`} className="mt-4 flex gap-2">
          <label htmlFor="portal-search-page" className="sr-only">
            {t("search.label")}
          </label>
          <input
            id="portal-search-page"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t("search.placeholder")}
            className="h-11 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          />
          <button className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("search.submit")}
          </button>
        </form>

        <details className="mt-4 rounded-lg border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">{t("search.rankingTitle")}</summary>
          <p className="mt-2 leading-relaxed text-muted-foreground">{t("search.rankingBody")}</p>
        </details>

        {q.length < 2 ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("search.emptyQuery")}</p>
        ) : page.results.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {t("search.noResults", { query: q })}
          </p>
        ) : (
          <div className="mt-8">
            <p className="text-sm text-muted-foreground">
              {t("search.resultCount", { count: page.results.length })}
            </p>
            <div className="mt-3 space-y-3">
              {page.results.map((result) => (
                <Link
                  key={`${result.kind}-${result.id}`}
                  href={result.href}
                  className="block rounded-lg border bg-card p-4 hover:border-primary/40"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`search.kind.${result.kind}`)}
                  </p>
                  <p className="mt-1 font-medium">{result.title}</p>
                  {result.excerpt ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {result.excerpt}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        )}

        {q.length < 2 || page.results.length === 0 ? suggestions : null}
      </main>
    </div>
  );
}
