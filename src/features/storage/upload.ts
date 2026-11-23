import "server-only";

import { getStorage } from "./index";
import {
  buildStorageKey,
  safeFileName,
  validateUpload,
  type StorageKind,
} from "./limits";
import type { StoredObject } from "./types";

export type StoreUploadInput = {
  workspaceId: string;
  productId: string;
  kind: StorageKind;
  fileName: string;
  mimeType: string;
  body: Uint8Array;
};

export type StoreUploadResult =
  | { ok: true; object: StoredObject }
  | { ok: false; error: string };

/**
 * Validate and store one upload.
 *
 * Callers still own the database row (attachment, cover metadata) and must
 * only persist the returned key after this succeeds.
 */
export async function storeUpload(input: StoreUploadInput): Promise<StoreUploadResult> {
  const validation = validateUpload({
    kind: input.kind,
    mimeType: input.mimeType,
    byteSize: input.body.byteLength,
    body: input.body,
  });
  if (!validation.ok) return validation;

  const key = buildStorageKey({
    workspaceId: input.workspaceId,
    productId: input.productId,
    kind: input.kind,
    fileName: input.fileName,
  });

  const object = await getStorage().put({
    key,
    fileName: safeFileName(input.fileName),
    contentType: input.mimeType,
    body: input.body,
  });

  return { ok: true, object };
}
