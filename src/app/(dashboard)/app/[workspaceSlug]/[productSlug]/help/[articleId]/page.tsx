import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteHelpArticleAction,
  saveHelpArticleAction,
  setHelpArticleStatusAction,
} from "@/features/help/actions";
import { getHelpArticleEditor } from "@/features/help/service";
import { requireProductContext } from "@/lib/authz";

export const metadata = { title: "Edit article" };

export default async function HelpArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; articleId: string }>;
  searchParams: Promise<{ saved?: string; error?: string; warning?: string }>;
}) {
  const { workspaceSlug, productSlug, articleId } = await params;
  const status = await searchParams;
  const context = await requireProductContext(workspaceSlug, productSlug, "settings:manage");
  const editor = await getHelpArticleEditor({
    productId: context.product.id,
    articleId,
  });
  if (!editor) notFound();

  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="articleId" value={editor.article.id} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={editor.article.title}
        description={`${editor.collection.name} · revision history is kept on every save.`}
      />
      <Link
        href={`/app/${workspaceSlug}/${productSlug}/help`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to help center
      </Link>
      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved.
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

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveHelpArticleAction} className="space-y-3">
            {hidden}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  name="title"
                  defaultValue={editor.article.title}
                  required
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-slug">Slug</Label>
                <Input
                  id="edit-slug"
                  name="slug"
                  defaultValue={editor.article.slug}
                  maxLength={80}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-body">Body (Markdown)</Label>
              <textarea
                id="edit-body"
                name="body"
                defaultValue={editor.article.body}
                required
                rows={20}
                className="w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5"
              />
            </div>
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Spanish translation (optional)</legend>
              <div className="space-y-1.5">
                <Label htmlFor="edit-translation-title-es">Título</Label>
                <Input
                  id="edit-translation-title-es"
                  name="translationTitleEs"
                  defaultValue={editor.article.translations?.es?.title ?? ""}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-translation-body-es">Cuerpo (Markdown)</Label>
                <textarea
                  id="edit-translation-body-es"
                  name="translationBodyEs"
                  defaultValue={editor.article.translations?.es?.body ?? ""}
                  rows={12}
                  className="w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Only shown when the workspace enables translated content and the visitor
                selects Spanish. Customer-authored content is never translated.
              </p>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="edit-visibility">Visibility</Label>
              <select
                id="edit-visibility"
                name="visibility"
                defaultValue={editor.article.visibility}
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            <Button type="submit">Save revision</Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <form action={setHelpArticleStatusAction}>
          {hidden}
          <input
            type="hidden"
            name="published"
            value={editor.article.status === "published" ? "false" : "true"}
          />
          <input type="hidden" name="returnToArticle" value="true" />
          <Button type="submit" variant={editor.article.status === "published" ? "outline" : "default"}>
            {editor.article.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </form>
        <form action={deleteHelpArticleAction}>
          {hidden}
          <Button type="submit" variant="ghost" className="text-destructive">
            Delete article
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revisions ({editor.revisions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {editor.revisions.map((revision) => (
              <li key={revision.id} className="flex justify-between gap-3 py-2">
                <span>
                  #{revision.revisionNumber} · {revision.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {revision.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
