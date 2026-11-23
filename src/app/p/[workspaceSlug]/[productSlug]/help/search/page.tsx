import Link from "next/link";
import { notFound } from "next/navigation";

import { searchPublicHelp } from "@/features/help/service";
import { getPublicSite } from "@/features/public/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicHelpSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { workspaceSlug, productSlug } = await params;
  const { q } = await searchParams;
  const site = await getPublicSite(workspaceSlug);
  const result = await searchPublicHelp({
    workspaceSlug,
    productSlug,
    query: q ?? "",
    locale: site.locale,
  });
  if (!result) notFound();

  return (
    <main id="public-main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href={`/p/${workspaceSlug}/${productSlug}/help`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Help center
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {q ? `Search results for “${q}”` : "Search help"}
      </h1>
      <form action={`/p/${workspaceSlug}/${productSlug}/help/search`} className="mt-5 flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          className="h-10 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          aria-label="Search help"
        />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Search
        </button>
      </form>

      {result.hits.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {q && q.trim().length >= 2
            ? "No published articles matched."
            : "Enter at least two characters to search."}
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {result.hits.map((hit) => (
            <li key={hit.id} className="rounded-lg border bg-card p-4">
              <Link
                href={`/p/${workspaceSlug}/${productSlug}/help/${hit.collectionSlug}/${hit.slug}`}
                className="font-medium hover:underline"
              >
                {hit.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {hit.collectionName} · {hit.excerpt}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
