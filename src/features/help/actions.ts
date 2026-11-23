"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authorizeProductAction } from "@/features/live/action-auth";

import {
  parseCsvImport,
  parseMarkdownImport,
  type HelpImportItem,
} from "./import-parse";
import {
  createHelpArticle,
  createHelpCollection,
  deleteHelpArticle,
  deleteHelpCollection,
  importHelpFromUrl,
  importHelpItems,
  saveHelpArticle,
  setHelpArticleStatus,
} from "./service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true";
}

function helpPath(workspaceSlug: string, productSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/help`;
}

function articlePath(workspaceSlug: string, productSlug: string, articleId: string): string {
  return `${helpPath(workspaceSlug, productSlug)}/${encodeURIComponent(articleId)}`;
}

async function authorized(workspaceSlug: string, productSlug: string, path: string) {
  const result = await authorizeProductAction(workspaceSlug, productSlug, "settings:manage");
  if ("error" in result) {
    redirect(`${path}?error=${encodeURIComponent(result.error.error)}`);
  }
  return result.context;
}

export async function createHelpCollectionAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = helpPath(workspaceSlug, productSlug);
  const context = await authorized(workspaceSlug, productSlug, path);
  const result = await createHelpCollection({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    description: text(formData, "description"),
    visibility: text(formData, "visibility") === "internal" ? "internal" : "public",
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(`${path}?saved=collection`);
}

export async function createHelpArticleAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = helpPath(workspaceSlug, productSlug);
  const context = await authorized(workspaceSlug, productSlug, path);
  const result = await createHelpArticle({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    collectionId: text(formData, "collectionId"),
    title: text(formData, "title"),
    slug: text(formData, "slug"),
    body: text(formData, "body"),
    translations: {
      es: {
        title: text(formData, "translationTitleEs"),
        body: text(formData, "translationBodyEs"),
      },
    },
    visibility: text(formData, "visibility") === "internal" ? "internal" : "public",
  });
  if (!result.ok || !result.id) {
    redirect(`${path}?error=${encodeURIComponent(result.ok ? "Article not created." : result.error)}`);
  }
  revalidatePath(path);
  redirect(articlePath(workspaceSlug, productSlug, result.id));
}

export async function saveHelpArticleAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const articleId = text(formData, "articleId");
  const path = articlePath(workspaceSlug, productSlug, articleId);
  const context = await authorized(workspaceSlug, productSlug, path);
  const result = await saveHelpArticle({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    articleId,
    title: text(formData, "title"),
    slug: text(formData, "slug"),
    body: text(formData, "body"),
    translations: {
      es: {
        title: text(formData, "translationTitleEs"),
        body: text(formData, "translationBodyEs"),
      },
    },
    visibility: text(formData, "visibility") === "internal" ? "internal" : "public",
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(
    `${path}?saved=article${result.warning ? `&warning=${encodeURIComponent(result.warning)}` : ""}`,
  );
}

export async function setHelpArticleStatusAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const articleId = text(formData, "articleId");
  const path = helpPath(workspaceSlug, productSlug);
  const context = await authorized(workspaceSlug, productSlug, path);
  const result = await setHelpArticleStatus({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    articleId,
    published: checked(formData, "published"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(
    checked(formData, "returnToArticle")
      ? `${articlePath(workspaceSlug, productSlug, articleId)}?saved=status`
      : `${path}?saved=status${result.warning ? `&warning=${encodeURIComponent(result.warning)}` : ""}`,
  );
}

export async function deleteHelpArticleAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = helpPath(workspaceSlug, productSlug);
  const context = await authorized(workspaceSlug, productSlug, path);
  const result = await deleteHelpArticle({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    articleId: text(formData, "articleId"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(`${path}?saved=deleted`);
}

export async function deleteHelpCollectionAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = helpPath(workspaceSlug, productSlug);
  const context = await authorized(workspaceSlug, productSlug, path);
  const result = await deleteHelpCollection({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    collectionId: text(formData, "collectionId"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(`${path}?saved=deleted`);
}

export async function importHelpAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = helpPath(workspaceSlug, productSlug);
  const context = await authorized(workspaceSlug, productSlug, path);
  const format = text(formData, "format");
  const collection = text(formData, "collection");
  let items: HelpImportItem[];

  try {
    if (format === "url") {
      const result = await importHelpFromUrl({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        url: text(formData, "url"),
        collection,
      });
      if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
      items = [result.item];
    } else {
      const file = formData.get("file");
      const content =
        file instanceof File && file.size > 0 ? await file.text() : text(formData, "content");
      if (!content.trim()) redirect(`${path}?error=${encodeURIComponent("Paste content or choose a file.")}`);
      items =
        format === "csv"
          ? parseCsvImport({ content, defaultCollection: collection })
          : [
              parseMarkdownImport({
                content,
                filename: file instanceof File ? file.name : "import.md",
                defaultCollection: collection,
              }),
            ];
    }
  } catch (error) {
    redirect(
      `${path}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "Could not parse the import.",
      )}`,
    );
  }

  const result = await importHelpItems({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    items,
    publish: checked(formData, "publish"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(
    `${path}?saved=imported&count=${result.imported ?? items.length}${
      result.warnings?.length
        ? `&warning=${encodeURIComponent(result.warnings.join(" "))}`
        : ""
    }`,
  );
}
