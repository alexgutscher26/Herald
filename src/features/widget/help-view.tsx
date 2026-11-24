"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  ChevronRight,
  CreditCard,
  Database,
  FileText,
  Headset,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Rocket,
  Search,
  Settings,
  Shield,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { createElement, useMemo, useState } from "react";

/**
 * Help index for the widget.
 *
 * Every collection and published article is already on the page; search and the
 * collection drill-in stay client-side so the iframe never needs a second
 * route. Articles open the real public help page in a new tab, which keeps
 * deep links and translations identical to the full site.
 */

export type WidgetHelpArticleView = {
  id: string;
  title: string;
  href: string;
};

export type WidgetHelpCollectionView = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  articles: WidgetHelpArticleView[];
};

export type WidgetHelpLabels = {
  title: string;
  search: string;
  noResults: string;
  searchHint: string;
  back: string;
  articles: string;
  articleOne: string;
  emptyTitle: string;
  emptyBody: string;
  noArticles: string;
};

const COLLECTION_ICONS: Array<{ match: RegExp; icon: LucideIcon }> = [
  { match: /start|intro|onboard|begin|quick/i, icon: Rocket },
  { match: /juno|\bai\b|bot|assistant/i, icon: Bot },
  { match: /setup|setting|workspace|account|config/i, icon: Settings },
  { match: /import|export|data|migrat/i, icon: Database },
  { match: /board|feedback|request|idea/i, icon: MessageCircle },
  { match: /roadmap|changelog|update|release|announce/i, icon: Megaphone },
  { match: /conversation|message|chat|support|inbox/i, icon: Headset },
  { match: /widget|install|embed|launcher/i, icon: LayoutGrid },
  { match: /sdk|swift|ios|android|mobile|api|develop|code/i, icon: Smartphone },
  { match: /billing|pricing|plan|payment/i, icon: CreditCard },
  { match: /security|privacy|permission|guard/i, icon: Shield },
];

function collectionIcon(collection: WidgetHelpCollectionView): LucideIcon {
  const haystack = `${collection.name} ${collection.slug}`;
  return COLLECTION_ICONS.find((entry) => entry.match.test(haystack))?.icon ?? FileText;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/50 px-4 py-8 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full border text-muted-foreground">
        <FileText className="size-4" aria-hidden="true" />
      </span>
      <p className="mt-2.5 text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function CollectionRow({
  collection,
  countLabel,
  articleOne,
  onOpen,
}: {
  collection: WidgetHelpCollectionView;
  countLabel: string;
  articleOne: string;
  onOpen: () => void;
}) {
  const icon = collectionIcon(collection);
  const count = collection.articles.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={
        count > 0
          ? `${collection.name}, ${count} ${
              count === 1 ? articleOne : countLabel
            }`
          : collection.name
      }
      className="group flex w-full items-center gap-4 px-0.5 py-3.5 text-left transition-colors duration-200 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-muted/60 text-foreground transition-transform duration-200 ease-out group-hover:scale-[1.04]"
      >
        {createElement(icon, { className: "size-[18px]", strokeWidth: 1.7 })}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight">
        {collection.name}
      </span>
      {count > 0 ? (
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5"
      />
    </button>
  );
}

function ArticleRow({
  article,
  collectionName,
}: {
  article: WidgetHelpArticleView;
  collectionName?: string;
}) {
  return (
    <a
      href={article.href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex items-center gap-3 px-0.5 py-3.5 transition-colors duration-200 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-foreground"
      >
        <FileText className="size-4" strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-snug">
          {article.title}
        </span>
        {collectionName ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {collectionName}
          </span>
        ) : null}
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
      />
    </a>
  );
}

export function WidgetHelpView({
  collections,
  labels,
}: {
  collections: WidgetHelpCollectionView[];
  labels: WidgetHelpLabels;
}) {
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const selected = selectedSlug
    ? (collections.find((collection) => collection.slug === selectedSlug) ?? null)
    : null;

  const { collectionHits, articleHits } = useMemo(() => {
    if (!needle) return { collectionHits: [], articleHits: [] };

    return {
      collectionHits: collections.filter(
        (collection) =>
          collection.name.toLowerCase().includes(needle) ||
          (collection.description ?? "").toLowerCase().includes(needle),
      ),
      articleHits: collections.flatMap((collection) =>
        collection.articles
          .filter((article) => article.title.toLowerCase().includes(needle))
          .map((article) => ({
            article,
            collectionName: collection.name,
          })),
      ),
    };
  }, [collections, needle]);

  if (selected && !needle) {
    const icon = collectionIcon(selected);

    return (
      <div className="space-y-4 pb-1">
        <button
          type="button"
          onClick={() => setSelectedSlug(null)}
          className="inline-flex min-h-7 items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {labels.back}
        </button>

        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-muted/60 text-foreground"
          >
            {createElement(icon, { className: "size-[18px]", strokeWidth: 1.7 })}
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-[22px] font-bold leading-tight tracking-[-0.03em]">
              {selected.name}
            </h1>
            {selected.description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {selected.description}
              </p>
            ) : null}
          </div>
        </div>

        {selected.articles.length === 0 ? (
          <EmptyState title={labels.emptyTitle} body={labels.noArticles} />
        ) : (
          <ul className="mt-1 divide-y divide-border/50">
            {selected.articles.map((article) => (
              <li key={article.id}>
                <ArticleRow article={article} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const searching = needle.length > 0;
  const noHits =
    searching && collectionHits.length === 0 && articleHits.length === 0;

  return (
    <div className="space-y-4 pb-1">
      <h1 className="pt-1 text-[28px] font-bold leading-[1.05] tracking-[-0.04em]">
        {labels.title}
      </h1>

      <label className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card px-4 py-3 text-muted-foreground transition-all duration-200 focus-within:border-ring focus-within:bg-background focus-within:shadow-sm">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          className="w-full min-w-0 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      {noHits ? (
        <EmptyState title={labels.noResults} body={labels.searchHint} />
      ) : (
        <div className="space-y-3">
          {(!searching ? collections : collectionHits).length > 0 ? (
            <ul className="divide-y divide-border/50">
              {(!searching ? collections : collectionHits).map((collection) => (
                <li key={collection.id}>
                  <CollectionRow
                    collection={collection}
                    countLabel={labels.articles}
                    articleOne={labels.articleOne}
                    onOpen={() => {
                      setQuery("");
                      setSelectedSlug(collection.slug);
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : null}

          {searching && articleHits.length > 0 ? (
            <ul className="divide-y divide-border/50">
              {articleHits.map(({ article, collectionName }) => (
                <li key={article.id}>
                  <ArticleRow
                    article={article}
                    collectionName={collectionName}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
