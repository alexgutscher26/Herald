/**
 * Inline images in a release body.
 *
 * The body stores a stable, same-origin path, never a base64 payload and never
 * a short-lived signed URL. The image route resolves that path against storage
 * and decides whether the caller may read it. Every upload gets a generated
 * key, so a key can only point at one object and replacing an image changes the
 * URL.
 */

const INLINE_IMAGE_KEY =
  /^workspaces\/[0-9a-fA-F-]{8,64}\/products\/[0-9a-fA-F-]{8,64}\/image\/[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/;

export function isInlineImageKey(value: string): boolean {
  return INLINE_IMAGE_KEY.test(value);
}

export function inlineImagePath(key: string): string {
  if (!isInlineImageKey(key)) throw new Error("Invalid inline image key.");
  return `/api/release-images/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** A filename is display text, not trusted Markdown syntax. */
export function inlineImageAlt(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const cleaned = withoutExtension
    .replace(/[\\[\]]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Release image";
}

export function sanitizeInlineImageAlt(value: string): string {
  return value
    .replace(/[\\[\]]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function inlineImageMarkdownWithAlt(key: string, alt: string): string {
  return `![${sanitizeInlineImageAlt(alt) || "Release image"}](${inlineImagePath(key)})`;
}

export function inlineImageMarkdown(key: string, fileName: string): string {
  return inlineImageMarkdownWithAlt(key, inlineImageAlt(fileName));
}

const INLINE_IMAGE_REFERENCE = /!\[[^\]]*\]\(\/api\/release-images\/[^)\s]+\)/g;

export function inlineImageReferences(body: string): string[] {
  return [...new Set(body.match(INLINE_IMAGE_REFERENCE) ?? [])];
}

/**
 * A rewrite must not silently drop an uploaded image. Any reference the model
 * omitted is appended to the rewritten body rather than lost.
 */
export function preserveInlineImageReferences(original: string, rewritten: string): string {
  const missing = inlineImageReferences(original).filter(
    (reference) => !rewritten.includes(reference),
  );
  if (missing.length === 0) return rewritten;
  return `${rewritten.trimEnd()}\n\n${missing.join("\n\n")}`;
}

/**
 * Insert a block at the current selection and return the new value plus where
 * the caret belongs. Blank lines keep a pasted image separate from prose so
 * Markdown renders it as its own block.
 */
export function insertMarkdownBlock(
  current: string,
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; caret: number } {
  const start = Math.min(Math.max(selectionStart, 0), current.length);
  const end = Math.min(Math.max(selectionEnd, start), current.length);
  const before = current.slice(0, start);
  const after = current.slice(end);
  const leading = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trailing = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${leading}${markdown}${trailing}`;
  return {
    value: `${before}${inserted}${after}`,
    caret: start + inserted.length,
  };
}
