"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authorizeProductAction } from "@/features/live/action-auth";

import {
  deleteApiDoc,
  fetchApiDocUrl,
  importApiDocVersion,
  publishApiDocVersion,
  rollbackApiDocVersion,
} from "./service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true";
}

function docsPath(workspaceSlug: string, productSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/api-docs`;
}

function docPath(workspaceSlug: string, productSlug: string, docId: string): string {
  return `${docsPath(workspaceSlug, productSlug)}/${encodeURIComponent(docId)}`;
}

export async function importApiDocAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = docsPath(workspaceSlug, productSlug);
  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );
  if ("error" in authorized) redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  const context = authorized.context;

  let raw = "";
  let source: "file" | "url" = "file";
  let sourceUrl: string | null = null;
  const url = text(formData, "url").trim();
  if (url) {
    const fetched = await fetchApiDocUrl(url);
    if (!fetched.ok) redirect(`${path}?error=${encodeURIComponent(fetched.error)}`);
    raw = fetched.content;
    source = "url";
    sourceUrl = fetched.url;
  } else {
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 5_000_000) redirect(`${path}?error=${encodeURIComponent("The file is too large.")}`);
      raw = await file.text();
    } else {
      raw = text(formData, "document");
    }
  }

  if (!raw.trim()) {
    redirect(`${path}?error=${encodeURIComponent("Choose a file, paste JSON, or enter a URL.")}`);
  }

  const version = text(formData, "version") || new Date().toISOString().slice(0, 10);
  const result = await importApiDocVersion({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    docSlug: text(formData, "docSlug"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    raw,
    version,
    source,
    sourceUrl,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  if (checked(formData, "publish")) {
    if (result.data.breaking && !checked(formData, "confirmBreaking")) {
      redirect(
        `${docPath(workspaceSlug, productSlug, result.data.docId)}?error=${encodeURIComponent(
          "Draft saved. This version has breaking changes, so review the diff and publish explicitly.",
        )}`,
      );
    }
    const published = await publishApiDocVersion({
      productId: context.product.id,
      versionId: result.data.versionId,
      confirmBreaking: checked(formData, "confirmBreaking"),
    });
    if (!published.ok) {
      redirect(`${docPath(workspaceSlug, productSlug, result.data.docId)}?error=${encodeURIComponent(published.error)}`);
    }
  }

  revalidatePath(path);
  redirect(`${docPath(workspaceSlug, productSlug, result.data.docId)}?saved=imported`);
}

export async function publishApiDocVersionAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const docId = text(formData, "docId");
  const path = docPath(workspaceSlug, productSlug, docId);
  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );
  if ("error" in authorized) redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);

  const result = await publishApiDocVersion({
    productId: authorized.context.product.id,
    versionId: text(formData, "versionId"),
    confirmBreaking: checked(formData, "confirmBreaking"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(`${path}?saved=published`);
}

export async function rollbackApiDocVersionAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const docId = text(formData, "docId");
  const path = docPath(workspaceSlug, productSlug, docId);
  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );
  if ("error" in authorized) redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);

  const result = await rollbackApiDocVersion({
    productId: authorized.context.product.id,
    versionId: text(formData, "versionId"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(`${path}?saved=rolled-back`);
}

export async function deleteApiDocAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = docsPath(workspaceSlug, productSlug);
  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );
  if ("error" in authorized) redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);

  const result = await deleteApiDoc({
    productId: authorized.context.product.id,
    docId: text(formData, "docId"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(path);
  redirect(`${path}?saved=deleted`);
}
