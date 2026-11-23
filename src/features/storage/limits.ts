import { randomUUID } from "node:crypto";

/**
 * Upload rules.
 *
 * Declared MIME types are not trusted: images and PDFs are checked against
 * their magic bytes, text files are rejected if they contain NUL bytes, and
 * every kind has its own size ceiling. Keys are generated, never supplied by
 * the client, and are restricted to safe path segments.
 */

export const STORAGE_KINDS = ["image", "cover", "social", "attachment"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export const MAX_UPLOAD_BYTES: Record<StorageKind, number> = {
  image: 5 * 1024 * 1024,
  cover: 8 * 1024 * 1024,
  social: 5 * 1024 * 1024,
  attachment: 10 * 1024 * 1024,
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ALLOWED_TYPES: Record<StorageKind, string[]> = {
  image: IMAGE_TYPES,
  cover: IMAGE_TYPES,
  social: IMAGE_TYPES,
  attachment: [...IMAGE_TYPES, "application/pdf", "text/plain"],
};

export type UploadCandidate = {
  kind: StorageKind;
  mimeType: string;
  byteSize: number;
  body?: Uint8Array;
};

export type UploadValidation =
  | { ok: true }
  | { ok: false; error: string };

export function sniffMimeType(body: Uint8Array): string | null {
  if (body.length >= 8) {
    const png =
      body[0] === 0x89 &&
      body[1] === 0x50 &&
      body[2] === 0x4e &&
      body[3] === 0x47 &&
      body[4] === 0x0d &&
      body[5] === 0x0a &&
      body[6] === 0x1a &&
      body[7] === 0x0a;
    if (png) return "image/png";
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }
  if (body.length >= 6) {
    const gif = String.fromCharCode(...body.slice(0, 6));
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }
  if (body.length >= 12) {
    const riff = String.fromCharCode(...body.slice(0, 4));
    const webp = String.fromCharCode(...body.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  if (body.length >= 5) {
    const pdf = String.fromCharCode(...body.slice(0, 5));
    if (pdf === "%PDF-") return "application/pdf";
  }
  return null;
}

function looksLikeText(body: Uint8Array): boolean {
  for (const byte of body) {
    if (byte === 0) return false;
    if (byte < 9) return false;
    if (byte > 13 && byte < 32) return false;
  }
  return true;
}

export function validateUpload(candidate: UploadCandidate): UploadValidation {
  if (!Number.isFinite(candidate.byteSize) || candidate.byteSize <= 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (candidate.byteSize > MAX_UPLOAD_BYTES[candidate.kind]) {
    return {
      ok: false,
      error: `The file is larger than ${Math.floor(
        MAX_UPLOAD_BYTES[candidate.kind] / (1024 * 1024),
      )} MB.`,
    };
  }

  const allowed = ALLOWED_TYPES[candidate.kind];
  if (!allowed.includes(candidate.mimeType)) {
    return { ok: false, error: "That file type is not allowed here." };
  }

  if (!candidate.body) return { ok: true };
  if (candidate.body.byteLength !== candidate.byteSize) {
    return { ok: false, error: "The uploaded file was incomplete." };
  }

  if (candidate.mimeType === "text/plain") {
    return looksLikeText(candidate.body)
      ? { ok: true }
      : { ok: false, error: "That file does not look like plain text." };
  }

  const sniffed = sniffMimeType(candidate.body);
  if (sniffed !== candidate.mimeType) {
    return { ok: false, error: "The file contents do not match its type." };
  }

  return { ok: true };
}

export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (key.startsWith("/") || key.includes("\\") || key.includes("..")) return false;
  return key.split("/").every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment));
}

export function safeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}

const SAFE_ID = /^[0-9a-fA-F-]{8,64}$/;

export function buildStorageKey(input: {
  workspaceId: string;
  productId: string;
  kind: StorageKind;
  fileName: string;
  id?: string;
}): string {
  if (!SAFE_ID.test(input.workspaceId) || !SAFE_ID.test(input.productId)) {
    throw new Error("Invalid storage scope.");
  }

  const name = safeFileName(input.fileName);
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
  const suffix = extension ? `.${extension}` : "";
  const id = input.id ?? randomUUID();

  return `workspaces/${input.workspaceId}/products/${input.productId}/${input.kind}/${id}${suffix}`;
}
