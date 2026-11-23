import { mapCategory, mapStatus, type ImportCategory, type ImportStatus } from "./adapters";
import { firstImageUrl } from "./plan";
import type { ImportMapping } from "./types";

/**
 * Pure source mappings for the API importers.
 *
 * GitHub issues and Herald API requests both become the same normalized row
 * shape a CSV produces, so the queue, dry-run rules, cancellation and row
 * reports need no source-specific branch.
 */

export type SourceRows = {
  headers: string[];
  rows: string[][];
  mapping: ImportMapping;
  fileName: string;
  /** Non-secret coordinates saved with the import. */
  sourceConfig: Record<string, string>;
};

export type GithubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: (string | { name?: string | null })[];
  user: { login?: string | null } | null;
  created_at: string;
  html_url?: string;
  pull_request?: unknown;
};

export type HeraldRequest = {
  title?: string | null;
  body?: string | null;
  status?: string | null;
  category?: string | null;
  board?: { slug?: string | null; name?: string | null } | null;
  author?: { name?: string | null; email?: string | null } | null;
  author_label?: string | null;
  author_email?: string | null;
  vote_count?: number | null;
  created_at?: string | null;
};

export const GITHUB_HEADERS = [
  "Number",
  "Title",
  "Body",
  "Status",
  "Category",
  "Author",
  "Created",
  "URL",
  "Cover image",
] as const;

export const GITHUB_MAPPING: ImportMapping = {
  title: "Title",
  body: "Body",
  status: "Status",
  category: "Category",
  authorName: "Author",
  createdAt: "Created",
  imageUrl: "Cover image",
};

export const HERALD_HEADERS = [
  "Title",
  "Body",
  "Status",
  "Category",
  "Board",
  "Author",
  "Email",
  "Votes",
  "Created",
  "Cover image",
] as const;

export const HERALD_MAPPING: ImportMapping = {
  title: "Title",
  body: "Body",
  status: "Status",
  category: "Category",
  board: "Board",
  authorName: "Author",
  authorEmail: "Email",
  votes: "Votes",
  createdAt: "Created",
  imageUrl: "Cover image",
};

function labelNames(issue: GithubIssue): string[] {
  return issue.labels
    .map((label) => (typeof label === "string" ? label : label.name ?? ""))
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

function githubStatus(issue: GithubIssue): ImportStatus {
  for (const label of labelNames(issue)) {
    const mapped = mapStatus(label);
    if (mapped) return mapped;
  }
  return issue.state.toLowerCase() === "closed" ? "closed" : "open";
}

function githubCategory(issue: GithubIssue): ImportCategory {
  for (const label of labelNames(issue)) {
    const mapped = mapCategory(label);
    if (mapped) return mapped;
  }
  return "feature_request";
}

export function mapGithubIssue(issue: GithubIssue): string[] {
  return [
    String(issue.number),
    issue.title.slice(0, 200),
    issue.body ?? "",
    githubStatus(issue),
    githubCategory(issue),
    issue.user?.login ?? "",
    issue.created_at,
    issue.html_url ?? "",
    firstImageUrl(issue.body ?? "") ?? "",
  ];
}

/** Issues only: the GitHub issues endpoint also returns pull requests. */
export function isGithubIssue(value: unknown): value is GithubIssue {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Partial<GithubIssue>;
  return (
    !issue.pull_request &&
    typeof issue.number === "number" &&
    typeof issue.title === "string" &&
    typeof issue.state === "string" &&
    Array.isArray(issue.labels)
  );
}

export function mapHeraldRequest(request: HeraldRequest): string[] {
  const status = mapStatus(request.status ?? undefined) ?? "open";
  const category = mapCategory(request.category ?? undefined) ?? "feature_request";
  const authorName = request.author?.name ?? request.author_label ?? "";
  const email = request.author?.email ?? request.author_email ?? "";
  const body = request.body ?? "";

  return [
    (request.title ?? "").slice(0, 200),
    body,
    status,
    category,
    request.board?.slug ?? request.board?.name ?? "",
    authorName,
    email,
    String(request.vote_count ?? 0),
    request.created_at ?? "",
    firstImageUrl(body) ?? "",
  ];
}
