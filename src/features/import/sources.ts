import "server-only";

import { assertCrawlableUrl } from "@/features/juno/crawl";

import {
  GITHUB_HEADERS,
  GITHUB_MAPPING,
  HERALD_HEADERS,
  HERALD_MAPPING,
  isGithubIssue,
  mapGithubIssue,
  mapHeraldRequest,
  type HeraldRequest,
  type SourceRows,
} from "./sources-map";

/**
 * API import sources.
 *
 * Both sources fetch a bounded number of pages, normalize every item into a
 * CSV-shaped row and hand it to the same stored-row pipeline. Tokens are used
 * for the fetch only and never written to the import record; only the
 * repository name or API origin is kept for display.
 */

export class ImportSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportSourceError";
  }
}

const PAGE_TIMEOUT_MS = 15_000;
const MAX_GITHUB_ISSUES = 1_000;
const MAX_HERALD_REQUESTS = 2_000;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function githubPage(
  repo: string,
  state: "open" | "all",
  page: number,
  token: string | null,
): Promise<unknown[]> {
  const url = new URL(`https://api.github.com/repos/${repo}/issues`);
  url.searchParams.set("state", state);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "created");
  url.searchParams.set("direction", "asc");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Herald-feedback-import",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 404) {
    throw new ImportSourceError("That repository was not found or the token cannot read it.");
  }
  if (response.status === 401) {
    throw new ImportSourceError("GitHub rejected the token.");
  }
  if (response.status === 403 || response.status === 429) {
    throw new ImportSourceError("GitHub rate-limited this import. Try again later.");
  }
  if (!response.ok) {
    throw new ImportSourceError(`GitHub answered ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new ImportSourceError("GitHub returned an unexpected response.");
  }
  return payload;
}

export async function fetchGithubIssues(input: {
  repo: string;
  token: string | null;
  includeClosed: boolean;
}): Promise<SourceRows> {
  const repo = input.repo.trim();
  if (!REPO_PATTERN.test(repo)) {
    throw new ImportSourceError("Use a repository name like owner/name.");
  }

  const state = input.includeClosed ? "all" : "open";
  const issues: string[][] = [];

  for (let page = 1; page <= 10 && issues.length < MAX_GITHUB_ISSUES; page += 1) {
    const payload = await githubPage(repo, state, page, input.token);
    for (const item of payload) {
      if (!isGithubIssue(item)) continue;
      issues.push(mapGithubIssue(item));
      if (issues.length >= MAX_GITHUB_ISSUES) break;
    }
    if (payload.length < 100) break;
  }

  if (issues.length === 0) {
    throw new ImportSourceError("That repository has no issues in the chosen state.");
  }

  return {
    headers: [...GITHUB_HEADERS],
    rows: issues,
    mapping: { ...GITHUB_MAPPING },
    fileName: `${repo} issues`,
    sourceConfig: { repo, includeClosed: String(input.includeClosed) },
  };
}

async function heraldPage(
  base: URL,
  cursor: string | null,
  token: string,
): Promise<{ data: HeraldRequest[]; nextCursor: string | null }> {
  const url = new URL(`api/v1/requests`, base);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "oldest");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new ImportSourceError("The Herald API rejected the token.");
  }
  if (!response.ok) {
    throw new ImportSourceError(`The Herald API answered ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: unknown;
    pagination?: { next_cursor?: string | null; has_more?: boolean };
  };
  if (!Array.isArray(payload.data)) {
    throw new ImportSourceError("The Herald API returned an unexpected response.");
  }

  return {
    data: payload.data as HeraldRequest[],
    nextCursor:
      payload.pagination?.has_more && payload.pagination.next_cursor
        ? payload.pagination.next_cursor
        : null,
  };
}

export async function fetchHeraldRequests(input: {
  baseUrl: string;
  token: string;
}): Promise<SourceRows> {
  const token = input.token.trim();
  if (token === "") throw new ImportSourceError("Enter an API token from the source workspace.");

  const raw = input.baseUrl.trim();
  if (raw === "") throw new ImportSourceError("Enter the source Herald URL.");

  let base: URL;
  try {
    base = await assertCrawlableUrl(raw);
  } catch {
    throw new ImportSourceError("That Herald URL is not publicly reachable.");
  }
  base.pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;

  const rows: string[][] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 20 && rows.length < MAX_HERALD_REQUESTS; page += 1) {
    const payload = await heraldPage(base, cursor, token);
    for (const request of payload.data) {
      if (typeof request !== "object" || request === null) continue;
      rows.push(mapHeraldRequest(request));
      if (rows.length >= MAX_HERALD_REQUESTS) break;
    }
    if (!payload.nextCursor) break;
    cursor = payload.nextCursor;
  }

  if (rows.length === 0) {
    throw new ImportSourceError("The source workspace has no requests to import.");
  }

  return {
    headers: [...HERALD_HEADERS],
    rows,
    mapping: { ...HERALD_MAPPING },
    fileName: `${base.hostname} requests`,
    sourceConfig: { baseUrl: base.origin },
  };
}
