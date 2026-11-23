import "server-only";

import { assertCrawlableUrl } from "@/features/juno/crawl";
import { storeUpload } from "@/features/storage/upload";
import { db } from "@/db";
import { feedbackAttachments } from "@/db/schema/feedback-extensions";

/**
 * Import a remote cover image.
 *
 * Every hop is checked with the same rules as the knowledge crawler: http(s)
 * only, no credentials or odd ports, and no hostname or DNS answer inside a
 * private, loopback, link-local or metadata range. Redirects are followed
 * manually so a public URL cannot bounce the server into 169.254.169.254.
 * Bytes are capped, the declared type must be an image, and the stored file is
 * sniffed again by the storage layer.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export class ImportImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportImageError";
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new ImportImageError("The image is larger than 8 MB.");
  }
  if (!response.body) throw new ImportImageError("The image had no content.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ImportImageError("The image is larger than 8 MB.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchImage(url: string): Promise<{
  body: Uint8Array;
  mimeType: string;
  fileName: string;
}> {
  let current = await assertCrawlableUrl(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ImportImageError("The image redirect had no destination.");
      current = await assertCrawlableUrl(new URL(location, current));
      continue;
    }

    if (!response.ok) {
      throw new ImportImageError(`The image host answered ${response.status}.`);
    }

    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!IMAGE_TYPES.has(mimeType)) {
      throw new ImportImageError("The URL did not return a supported image type.");
    }

    const name = current.pathname.split("/").filter(Boolean).pop() || "cover";
    return { body: await readCapped(response), mimeType, fileName: name.slice(0, 120) };
  }

  throw new ImportImageError("The image redirected too many times.");
}

export type StoredImportImage = {
  storageKey: string;
  fileName: string;
  checksum: string;
  byteSize: number;
  mimeType: string;
};

/** Download one image and store it under the product's storage scope. */
export async function downloadImportImage(input: {
  workspaceId: string;
  productId: string;
  url: string;
}): Promise<StoredImportImage> {
  const image = await fetchImage(input.url);
  const stored = await storeUpload({
    workspaceId: input.workspaceId,
    productId: input.productId,
    kind: "cover",
    fileName: image.fileName,
    mimeType: image.mimeType,
    body: image.body,
  });
  if (!stored.ok) throw new ImportImageError(stored.error);
  return {
    storageKey: stored.object.key,
    fileName: stored.object.fileName,
    checksum: stored.object.checksum,
    byteSize: stored.object.byteSize,
    mimeType: stored.object.contentType,
  };
}

/**
 * Attach an imported cover to its post.
 *
 * Failure here never fails the request itself: the row is still imported and
 * the reason is appended to its report so an operator can retry or ignore it.
 */
export async function attachImportedCover(input: {
  workspaceId: string;
  productId: string;
  postId: string;
  customerId: string | null;
  url: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const image = await downloadImportImage({
      workspaceId: input.workspaceId,
      productId: input.productId,
      url: input.url,
    });

    await db.insert(feedbackAttachments).values({
      productId: input.productId,
      feedbackPostId: input.postId,
      uploadedByCustomerId: input.customerId,
      storageKey: image.storageKey,
      fileName: image.fileName,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      checksum: image.checksum,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ImportImageError
          ? error.message
          : "The cover image could not be fetched.",
    };
  }
}
