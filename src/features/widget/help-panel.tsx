import type { getPublicHelpIndex } from "@/features/help/service";
import type { Translate } from "@/features/public/i18n";

import { WidgetHelpView, type WidgetHelpCollectionView } from "./help-view";
import { WidgetEmpty } from "./shell";

type HelpIndex = NonNullable<Awaited<ReturnType<typeof getPublicHelpIndex>>>;

/**
 * Help panel wrapper.
 *
 * The service already applied the widget locale to every collection and
 * article title, so this only shapes hrefs and copy for the client view. No
 * widget-only query exists: the same published, public rows the help site uses
 * decide what appears here.
 */
export function WidgetHelpPanel({
  help,
  workspaceSlug,
  productSlug,
  t,
}: {
  help: HelpIndex | null;
  workspaceSlug: string;
  productSlug: string;
  t: Translate;
}) {
  if (!help || help.collections.length === 0) {
    return (
      <WidgetEmpty
        title={t("widget.helpEmptyTitle")}
        body={t("widget.helpEmptyBody")}
      />
    );
  }

  const base = `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/help`;

  const collections: WidgetHelpCollectionView[] = help.collections.map(
    (collection) => ({
      id: collection.id,
      slug: collection.slug,
      name: collection.name,
      description: collection.description,
      articles: collection.articles.map((article) => ({
        id: article.id,
        title: article.title,
        href: `${base}/${encodeURIComponent(
          collection.slug,
        )}/${encodeURIComponent(article.slug)}`,
      })),
    }),
  );

  return (
    <WidgetHelpView
      collections={collections}
      labels={{
        title: t("widget.helpTitle"),
        search: t("widget.helpSearch"),
        noResults: t("widget.helpNoResults"),
        searchHint: t("widget.helpSearchHint"),
        back: t("widget.helpBack"),
        articles: t("widget.helpArticles"),
        articleOne: t("widget.helpArticleOne"),
        emptyTitle: t("widget.helpEmptyTitle"),
        emptyBody: t("widget.helpEmptyBody"),
        noArticles: t("widget.helpNoArticles"),
      }}
    />
  );
}
