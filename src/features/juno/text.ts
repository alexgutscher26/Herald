/**
 * Document parsing, chunking and lexical scoring.
 *
 * Pure functions: ingestion and retrieval both depend on the same
 * normalization, and the unit suite can exercise every boundary without a
 * database or a network. `server-only` is deliberately absent so the module
 * can be imported by tests and by the crawler.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const CHUNK_MAX_CHARS = 1_200;
export const CHUNK_OVERLAP_CHARS = 200;
export const PATH_PREFIX_MAX = 512;

const UPLOAD_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  ".json",
  ".yaml",
  ".yml",
  ".pdf",
] as const;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

const STOPWORDS = new Set(
  [
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "could",
    "do",
    "does",
    "for",
    "from",
    "has",
    "have",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "so",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "this",
    "to",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your",
  ].map((word) => word),
);

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function entityChar(raw: string): string | null {
  const key = raw.toLowerCase();
  if (key.startsWith("#x")) {
    const code = Number.parseInt(key.slice(2), 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : null;
  }
  if (key.startsWith("#")) {
    const code = Number.parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : null;
  }
  return ENTITIES[key] ?? null;
}

export function decodeEntities(input: string): string {
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, raw: string) => entityChar(raw) ?? match,
  );
}

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip scripts, styles, comments and tags, keeping block boundaries. */
export function stripHtml(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const withBreaks = withoutBlocks
    .replace(
      /<\/(p|div|li|h[1-6]|section|article|tr|td|th|blockquote|pre|header|footer|main|nav)>/gi,
      "\n",
    )
    .replace(/<br\s*\/?>/gi, "\n");

  // Inline tags are removed without inserting a space: the source already
  // carries the spacing, and a synthetic space would turn `Settings</b>,`
  // into `Settings ,`.
  return normalizeText(decodeEntities(withBreaks.replace(/<[^>]+>/g, "")));
}

function flattenJson(value: unknown, depth = 0): string[] {
  if (depth > 12) return [];
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap((item) => flattenJson(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      flattenJson(item, depth + 1),
    );
  }
  return [];
}

export function isAllowedUpload(filename: string, mimeType?: string | null): boolean {
  const lower = filename.toLowerCase();
  if (UPLOAD_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true;
  const mime = (mimeType ?? "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/x-yaml" ||
    mime === "application/yaml" ||
    mime === "application/pdf"
  );
}

export function isPdfUpload(filename: string, mimeType?: string | null): boolean {
  return (
    filename.toLowerCase().endsWith(".pdf") ||
    (mimeType ?? "").toLowerCase() === "application/pdf"
  );
}

export type ParsedDocument = { text: string; title: string | null };

/** Turn an uploaded Markdown/plain/HTML/JSON/YAML (or extracted PDF) text into plain text. */
export function parseDocument(input: {
  filename: string;
  mimeType?: string | null | undefined;
  content: string;
}): ParsedDocument {
  if (byteLength(input.content) > MAX_DOCUMENT_BYTES) {
    throw new Error("Documents must be 10 MB or smaller.");
  }

  const lower = input.filename.toLowerCase();
  const mime = (input.mimeType ?? "").toLowerCase();
  const isHtml = lower.endsWith(".html") || lower.endsWith(".htm") || mime.includes("html");
  const isJson = lower.endsWith(".json") || mime.includes("json");

  let text = input.content;
  if (isHtml) {
    text = stripHtml(text);
  } else if (isJson) {
    try {
      text = flattenJson(JSON.parse(text)).join("\n");
    } catch {
      text = input.content;
    }
  }

  text = normalizeText(text);
  if (text === "") throw new Error("The document is empty.");

  const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? "";
  const title = firstLine.replace(/^#+\s*/, "").slice(0, 120) || null;
  return { text, title };
}

/**
 * Split text into overlapping chunks.
 *
 * Chunks break on paragraph and sentence boundaries; a single oversized
 * sentence is hard-sliced so a chunk never grows without bound.
 */
export function chunkText(
  text: string,
  options: { maxChars?: number; overlapChars?: number } = {},
): string[] {
  const maxChars = Math.max(200, options.maxChars ?? CHUNK_MAX_CHARS);
  const overlapChars = Math.min(
    Math.max(0, options.overlapChars ?? CHUNK_OVERLAP_CHARS),
    Math.floor(maxChars / 2),
  );

  const normalized = normalizeText(text);
  if (normalized === "") return [];

  const segments = normalized
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed !== "") chunks.push(trimmed);
    current = "";
  };

  for (const segment of segments) {
    if (segment.length > maxChars) {
      flush();
      const step = maxChars - overlapChars;
      for (let start = 0; start < segment.length; start += step) {
        const slice = segment.slice(start, start + maxChars).trim();
        if (slice !== "") chunks.push(slice);
        if (start + maxChars >= segment.length) break;
      }
      const tail = chunks.at(-1)?.slice(-overlapChars) ?? "";
      current = tail;
      continue;
    }

    const candidate = current === "" ? segment : `${current}\n${segment}`;
    if (candidate.length > maxChars) {
      const tail = current.slice(-overlapChars).trim();
      flush();
      const withTail = tail === "" ? segment : `${tail}\n${segment}`;
      current = withTail.length > maxChars ? segment : withTail;
    } else {
      current = candidate;
    }
  }

  flush();

  // Overlap can repeat an identical boundary chunk; keep the first copy.
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    if (seen.has(chunk)) return false;
    seen.add(chunk);
    return true;
  });
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Fraction of query terms present in the content, with a 4-char prefix fallback. */
export function lexicalScore(query: string, content: string): number {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return 0;

  const contentTokens = new Set(tokenize(content));
  let matched = 0;

  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matched += 1;
      continue;
    }
    if (token.length >= 4) {
      const prefix = token.slice(0, 4);
      for (const candidate of contentTokens) {
        if (candidate.startsWith(prefix)) {
          matched += 1;
          break;
        }
      }
    }
  }

  return matched / queryTokens.length;
}
