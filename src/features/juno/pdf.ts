import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { normalizeText } from "./text";

/**
 * Extract readable text from an uploaded PDF.
 *
 * PDF.js runs entirely in process, so the document never leaves the server.
 * A scanned PDF has no text layer; refusing it with an explicit message is
 * better than indexing a blank source or silently pretending OCR happened.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const extracted = await extractText(pdf, { mergePages: true });
    text = extracted.text;
  } catch {
    throw new Error("That PDF could not be read.");
  }

  const normalized = normalizeText(text);
  if (normalized === "") {
    throw new Error(
      "That PDF has no extractable text. Scanned PDFs need OCR before they can be indexed.",
    );
  }
  return normalized;
}
