import "server-only";

import { getImageTextConfig } from "@/lib/env";

/**
 * Image-text extraction for moderation.
 *
 * Only text extracted from the image is inspected; the image is never stored
 * by this module and the extracted text is never persisted. The provider is
 * operator-configured (see `getImageTextConfig`). When it is absent or fails,
 * the result says so: an unscanned image is not a clean image.
 */

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type ImageTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unsupported" | "unavailable" | "error" };

export function isSupportedImageMimeType(
  mimeType: string,
): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function imageTextConfigured(): boolean {
  try {
    return getImageTextConfig() !== null;
  } catch {
    return false;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 100_000;

export async function extractImageText(input: {
  body: Uint8Array;
  mimeType: string;
  fileName: string;
}): Promise<ImageTextResult> {
  if (!isSupportedImageMimeType(input.mimeType)) {
    return { ok: false, reason: "unsupported" };
  }

  let config: ReturnType<typeof getImageTextConfig>;
  try {
    config = getImageTextConfig();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!config) return { ok: false, reason: "unavailable" };

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.body)], { type: input.mimeType }),
    input.fileName,
  );
  form.append("mimeType", input.mimeType);

  const headers: Record<string, string> = {};
  if (config.OCR_API_KEY) {
    headers.authorization = `Bearer ${config.OCR_API_KEY}`;
  }

  try {
    const response = await fetch(config.OCR_API_URL, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "error" };

    const data: unknown = await response.json().catch(() => null);
    const text = readText(data);
    if (text === null) return { ok: false, reason: "error" };

    return { ok: true, text: text.slice(0, MAX_TEXT_LENGTH) };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function readText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;

  for (const key of ["result", "data"] as const) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null) {
      const text = (nested as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }

  return null;
}
