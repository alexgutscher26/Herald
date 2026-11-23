import {
  IMPORT_FIELDS,
  headerKey,
  isImportFormat,
  type ImportField,
  type ImportFormat,
  type ImportMapping,
} from "./types";

/**
 * Adapters are presets, not separate importers.
 *
 * Canny, Productboard and Nolt all export CSV; they differ in what they call a
 * column and how they spell a status. `suggestMapping` proposes a column per
 * field and `mapStatus` translates the vocabulary. The user can always correct
 * the mapping before the import starts.
 */

export type ImportStatus =
  | "open"
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped"
  | "closed";

export type ImportCategory = "feature_request" | "bug" | "improvement" | "question";

const COMMON_SYNONYMS: Record<ImportField, string[]> = {
  title: ["title", "name", "summary", "request", "idea", "subject", "feature"],
  body: ["details", "description", "body", "content", "text", "requestdetails"],
  board: ["board", "boardname", "boardurl", "list", "topic"],
  // "category" is deliberately not a board synonym: Beamer uses Category for
  // the request type, and a board must not steal it before `category` maps.
  status: ["status", "state", "stage"],
  category: ["category", "type", "feedbacktype", "requesttype"],
  authorName: [
    "author",
    "authorname",
    "createdby",
    "creator",
    "submitter",
    "user",
    "username",
    "voter",
  ],
  authorEmail: [
    "authoremail",
    "email",
    "useremail",
    "createdbyemail",
    "submitteremail",
    "voteremail",
    "contactemail",
  ],
  votes: ["votes", "votecount", "upvotes", "score", "numberofvotes", "vote"],
  createdAt: [
    "createdat",
    "created",
    "date",
    "submittedat",
    "createddate",
    "creationdate",
    "createdon",
    "datecreated",
  ],
  imageUrl: ["coverimage", "image", "imageurl", "cover", "coverurl", "thumbnail", "thumbnailurl"],
};

const PREFERRED: Record<ImportFormat, Partial<Record<ImportField, string[]>>> = {
  generic: {},
  canny: {
    title: ["Title"],
    body: ["Details"],
    board: ["Board"],
    status: ["Status"],
    votes: ["Vote count", "Votes"],
    authorName: ["Author"],
    createdAt: ["Created", "Created at"],
    category: ["Category"],
  },
  productboard: {
    title: ["Name", "Feature"],
    body: ["Description"],
    board: ["Product", "Component"],
    status: ["Status"],
    category: ["Type"],
    authorName: ["Owner", "Created by"],
    votes: ["Votes", "User impact"],
    createdAt: ["Created at", "Created"],
  },
  nolt: {
    title: ["Title"],
    body: ["Body", "Description"],
    board: ["Board"],
    status: ["Status"],
    category: ["Category"],
    votes: ["Votes"],
    authorName: ["Author", "Created by"],
    createdAt: ["Created at", "Date"],
  },
  frill: {
    title: ["Title"],
    body: ["Description", "Body"],
    board: ["Board"],
    status: ["Status"],
    category: ["Category", "Type"],
    votes: ["Votes", "Vote count"],
    authorName: ["Author", "Created by"],
    authorEmail: ["Author email", "Email"],
    createdAt: ["Created at", "Date"],
  },
  beamer: {
    title: ["Title"],
    body: ["Content", "Description", "Body"],
    board: ["Board"],
    status: ["Status"],
    category: ["Category", "Type"],
    votes: ["Reactions", "Votes"],
    authorName: ["Author", "Created by"],
    createdAt: ["Published at", "Created at", "Date"],
  },
};

const SIGNALS: Record<Exclude<ImportFormat, "generic">, string[]> = {
  canny: ["votecount", "details", "author", "created"],
  productboard: ["userimpact", "owner", "description", "component"],
  nolt: ["body", "board", "votes", "author"],
  frill: ["description", "status", "votes", "author"],
  beamer: ["content", "publishedat", "reactions", "category"],
};

/** Guess the export format from its headers. A weak guess stays generic. */
export function detectFormat(headers: string[]): ImportFormat {
  const keys = new Set(headers.map(headerKey));
  let best: { format: ImportFormat; score: number } = { format: "generic", score: 0 };

  for (const format of ["canny", "productboard", "nolt", "frill", "beamer"] as const) {
    const score = SIGNALS[format].filter((signal) => keys.has(signal)).length;
    if (score > best.score) best = { format, score };
  }

  return best.score >= 2 ? best.format : "generic";
}

/**
 * Suggest a column for every field.
 *
 * Preferred headers for the chosen format win, then common synonyms. A header
 * is never assigned twice: the first field that claims it keeps it.
 */
export function suggestMapping(headers: string[], format: ImportFormat): ImportMapping {
  const byKey = new Map<string, string>();
  for (const header of headers) {
    const key = headerKey(header);
    if (!byKey.has(key)) byKey.set(key, header);
  }

  const used = new Set<string>();
  const mapping: ImportMapping = {};
  const preferred = PREFERRED[format];

  for (const field of IMPORT_FIELDS) {
    const candidates = [...(preferred[field] ?? []), ...COMMON_SYNONYMS[field]];

    for (const candidate of candidates) {
      const header = byKey.get(headerKey(candidate));
      if (!header || used.has(header)) continue;
      mapping[field] = header;
      used.add(header);
      break;
    }
  }

  return mapping;
}

/** A mapping is valid when it names columns that exist and includes a title. */
export function validateMapping(
  headers: string[],
  mapping: ImportMapping,
): { ok: true; mapping: ImportMapping } | { ok: false; error: string } {
  const headerSet = new Set(headers);
  const cleaned: ImportMapping = {};

  for (const field of IMPORT_FIELDS) {
    const header = mapping[field]?.trim();
    if (!header) continue;
    if (!headerSet.has(header)) {
      return { ok: false, error: `The column "${header}" is not in this file.` };
    }
    cleaned[field] = header;
  }

  if (!cleaned.title) {
    return { ok: false, error: "Map a column to Title before importing." };
  }

  return { ok: true, mapping: cleaned };
}

function words(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STATUS_WORDS: Record<string, ImportStatus> = {
  open: "open",
  new: "open",
  idea: "open",
  newidea: "open",
  submitted: "open",
  pending: "open",
  review: "under_review",
  underreview: "under_review",
  reviewing: "under_review",
  consideration: "under_review",
  underconsideration: "under_review",
  considering: "under_review",
  planned: "planned",
  planning: "planned",
  next: "planned",
  accepted: "planned",
  inprogress: "in_progress",
  progress: "in_progress",
  started: "in_progress",
  building: "in_progress",
  dev: "in_progress",
  indevelopment: "in_progress",
  shipped: "shipped",
  complete: "shipped",
  completed: "shipped",
  done: "shipped",
  released: "shipped",
  live: "shipped",
  closed: "closed",
  declined: "closed",
  wontdo: "closed",
  "will not do": "closed",
  notplanned: "closed",
  archived: "closed",
  rejected: "closed",
  duplicate: "closed",
};

/**
 * Translate a status from any supported export.
 *
 * `null` means the word is unknown; the row still imports as Open and the
 * original value is recorded in the row report, so nothing is silently lost.
 */
export function mapStatus(value: string | undefined): ImportStatus | null {
  if (!value) return null;
  const key = words(value).replace(/\s+/g, "");
  const spaced = words(value);
  return STATUS_WORDS[key] ?? STATUS_WORDS[spaced] ?? null;
}

const CATEGORY_WORDS: Record<string, ImportCategory> = {
  featurerequest: "feature_request",
  feature: "feature_request",
  idea: "feature_request",
  enhancement: "improvement",
  improvement: "improvement",
  bug: "bug",
  defect: "bug",
  issue: "bug",
  problem: "bug",
  question: "question",
  support: "question",
  help: "question",
};

export function mapCategory(value: string | undefined): ImportCategory | null {
  if (!value) return null;
  return CATEGORY_WORDS[words(value).replace(/\s+/g, "")] ?? null;
}

/** Parse a vote cell such as `1,204` or `12` into a non-negative integer. */
export function parseVotes(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Parse a date cell; `null` means unparseable and the row uses the import time. */
export function parseCreatedAt(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export { isImportFormat };
