import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createHelpArticleAction,
  createHelpCollectionAction,
  deleteHelpArticleAction,
  deleteHelpCollectionAction,
  importHelpAction,
  setHelpArticleStatusAction,
} from "@/features/help/actions";
import { listCollectionsForSelect, listHelpAdmin } from "@/features/help/service";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = { title: "Help center" };

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";
const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5 focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

export default async function HelpAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ saved?: string; error?: string; warning?: string }>;
}) {
    const status = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");
  const [{ collections, articles }, collectionOptions] = await Promise.all([
    listHelpAdmin(context.product.id),
    listCollectionsForSelect(context.product.id),
  ]);
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help center"
        description="Articles are stored as data, published on the public portal, and projected into Mira as a versioned knowledge source."
      />

      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved{status.saved === "imported" ? ` · imported ${status.saved}` : ""}.
        </p>
      ) : null}
      {status.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}
      {status.warning ? (
        <p className="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning">
          {status.warning}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Collections</CardTitle>
            <CardDescription>Public collections appear in the portal and feed Mira.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {collections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No collections yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {collections.map((collection) => (
                  <li key={collection.id} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{collection.name}</p>
                      <p className="text-xs text-muted-foreground">
                        /{collection.slug} · {collection.articleCount} articles ·{" "}
                        {collection.publishedCount} published · {collection.visibility}
                      </p>
                    </div>
                    <form action={deleteHelpCollectionAction}>
                      {hidden}
                      <input type="hidden" name="collectionId" value={collection.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                        Delete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form action={createHelpCollectionAction} className="space-y-3 border-t pt-4">
              {hidden}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="collection-name">Name</Label>
                  <Input id="collection-name" name="name" required maxLength={120} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="collection-slug">Slug (optional)</Label>
                  <Input id="collection-slug" name="slug" maxLength={80} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="collection-description">Description</Label>
                <Input id="collection-description" name="description" maxLength={1000} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="collection-visibility">Visibility</Label>
                <select id="collection-visibility" name="visibility" className={SELECT_CLASS}>
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                </select>
              </div>
              <Button type="submit" size="sm">Create collection</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New article</CardTitle>
            <CardDescription>Drafts are private until published and public.</CardDescription>
          </CardHeader>
          <CardContent>
            {collectionOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Create a collection first.</p>
            ) : (
              <form action={createHelpArticleAction} className="space-y-3">
                {hidden}
                <div className="space-y-1.5">
                  <Label htmlFor="article-collection">Collection</Label>
                  <select id="article-collection" name="collectionId" className={SELECT_CLASS}>
                    {collectionOptions.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="article-title">Title</Label>
                  <Input id="article-title" name="title" required maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="article-slug">Slug (optional)</Label>
                  <Input id="article-slug" name="slug" maxLength={80} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="article-body">Body (Markdown)</Label>
                  <textarea id="article-body" name="body" required rows={8} className={TEXTAREA_CLASS} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="article-visibility">Visibility</Label>
                  <select id="article-visibility" name="visibility" className={SELECT_CLASS}>
                    <option value="public">Public</option>
                    <option value="internal">Internal</option>
                  </select>
                </div>
                <Button type="submit" size="sm">Create draft</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Articles</CardTitle>
          <CardDescription>Drafts, published articles and revision history.</CardDescription>
        </CardHeader>
        <CardContent>
          {articles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No articles yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {articles.map((article) => (
                <li key={article.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/app/${workspaceSlug}/${productSlug}/help/${article.id}`}
                      className="font-medium hover:underline"
                    >
                      {article.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {article.collectionName} · /{article.slug} · {article.visibility}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={article.status === "published" ? "success" : "neutral"}>
                      {article.status}
                    </StatusBadge>
                    <form action={setHelpArticleStatusAction}>
                      {hidden}
                      <input type="hidden" name="articleId" value={article.id} />
                      <input
                        type="hidden"
                        name="published"
                        value={article.status === "published" ? "false" : "true"}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        {article.status === "published" ? "Unpublish" : "Publish"}
                      </Button>
                    </form>
                    <form action={deleteHelpArticleAction}>
                      {hidden}
                      <input type="hidden" name="articleId" value={article.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                        Delete
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import</CardTitle>
          <CardDescription>
            Markdown with optional front matter, CSV with title/body/collection columns, or a
            public URL. Imports are drafts unless you publish them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={importHelpAction} className="space-y-3">
            {hidden}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-format">Format</Label>
                <select id="import-format" name="format" className={SELECT_CLASS}>
                  <option value="markdown">Markdown</option>
                  <option value="csv">CSV</option>
                  <option value="url">URL</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-collection">Default collection</Label>
                <Input id="import-collection" name="collection" placeholder="Help center" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-file">File (Markdown or CSV)</Label>
              <input
                id="import-file"
                type="file"
                name="file"
                accept=".md,.markdown,.txt,.csv"
                className="block w-full text-xs text-muted-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-url">URL</Label>
              <Input id="import-url" name="url" placeholder="https://docs.example.com/guide" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-content">Or paste content</Label>
              <textarea id="import-content" name="content" rows={7} className={TEXTAREA_CLASS} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="publish" /> Publish imported articles
            </label>
            <Button type="submit" size="sm">Import</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
