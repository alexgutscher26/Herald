import Link from "next/link";

import type { getPublicHelpIndex } from "@/features/help/service";
import type { PublicLocaleCode, Translate } from "@/features/public/i18n";

import { WidgetEmpty } from "./shell";

type HelpIndex = NonNullable<Awaited<ReturnType<typeof getPublicHelpIndex>>>;

export function WidgetHelpPanel({
  help,
  workspaceSlug,
  productSlug,
  t,
  locale,
}: {
  help: HelpIndex | null;
  workspaceSlug: string;
  productSlug: string;
  t: Translate;
  locale: PublicLocaleCode;
}) {
  void locale;
  if (!help || help.collections.length === 0) {
    return (
      <WidgetEmpty
        title="Help"
        body="No help articles have been published yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-lg font-semibold tracking-tight">Help</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse guides and answers from {help.product.productName}.
        </p>
      </section>
      <div className="space-y-3">
        {help.collections.map((collection) => (
          <section key={collection.id} className="rounded-lg border bg-card p-3">
            <p className="text-sm font-semibold">{collection.name}</p>
            {collection.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{collection.description}</p>
            ) : null}
            <ul className="mt-2 space-y-1.5">
              {collection.articles.map((article) => (
                <li key={article.id}>
                  <Link
                    href={`/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
                      productSlug,
                    )}/help/${encodeURIComponent(collection.slug)}/${encodeURIComponent(
                      article.slug,
                    )}`}
                    target="_blank"
                    className="block rounded-md px-2 py-1.5 text-xs leading-snug hover:bg-muted"
                  >
                    {article.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
