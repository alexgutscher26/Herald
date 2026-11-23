/**
 * Request brief builder.
 *
 * Pure on purpose: the same input always produces byte-identical Markdown, so a
 * dashboard copy, a REST client and an agent all paste the same text into a
 * ticket or PRD. Nothing here reads a clock, a session or a database, and the
 * input type deliberately has no contact details — an author email can never
 * leak into a brief because there is nowhere to put it.
 *
 * The brief answers five questions in a fixed order: what is the problem, what
 * evidence supports it, how much demand is there, where does it stand, and what
 * is still unknown. Internal notes are not part of the contract; the caller
 * supplies public comments only, and the builder drops any row marked internal.
 */

export const REQUEST_BRIEF_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  closed: "Closed",
};

export const REQUEST_BRIEF_CATEGORY_LABELS: Record<string, string> = {
  feature_request: "Feature request",
  bug: "Bug",
  improvement: "Improvement",
  question: "Question",
};

export type RequestBriefVoter = {
  id: string;
  name: string | null;
  company: string | null;
};

export type RequestBriefInsight = {
  quote: string;
  source: string;
  authorLabel: string | null;
  occurredAt: Date;
};

export type RequestBriefComment = {
  body: string;
  authorName: string;
  authorType: string;
  createdAt: Date;
  internal?: boolean;
};

export type RequestBriefRelease = {
  title: string;
  slug: string;
  status: string;
  publishedAt: Date | null;
};

export type RequestBriefInput = {
  workspaceSlug: string;
  productName: string;
  requestId: string;
  title: string;
  body: string;
  status: string;
  category: string;
  boardName: string | null;
  createdAt: Date;
  updatedAt: Date;
  voteCount: number;
  teamVoteCount: number;
  importedVoteCount: number;
  voters: RequestBriefVoter[];
  insights: RequestBriefInsight[];
  comments: RequestBriefComment[];
  tags: string[];
  releases: RequestBriefRelease[];
};

function time(value: Date | null): number {
  if (!value) return 0;
  const ms = value.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function day(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return "unknown date";
  return value.toISOString().slice(0, 10);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function segmentCounts(voters: RequestBriefVoter[]) {
  const counts = new Map<string, number>();
  for (const voter of voters) {
    const label = oneLine(voter.company ?? "") || "No company";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
}

type EvidenceItem = {
  at: Date;
  attribution: string;
  quote: string;
};

/** Chronological, and stable when two items share a timestamp. */
function evidenceItems(input: RequestBriefInput): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  for (const insight of input.insights) {
    const quote = insight.quote.trim();
    if (quote.length === 0) continue;
    const author = oneLine(insight.authorLabel ?? "");
    items.push({
      at: insight.occurredAt,
      attribution: [insight.source, author].filter(Boolean).join(" · "),
      quote,
    });
  }

  for (const comment of input.comments) {
    if (comment.internal === true) continue;
    const body = comment.body.trim();
    if (body.length === 0) continue;
    const kind = comment.authorType === "customer" ? "public comment" : "team comment";
    items.push({
      at: comment.createdAt,
      attribution: [kind, oneLine(comment.authorName)].filter(Boolean).join(" · "),
      quote: body,
    });
  }

  return items.sort(
    (a, b) =>
      time(a.at) - time(b.at) ||
      a.attribution.localeCompare(b.attribution, "en") ||
      a.quote.localeCompare(b.quote, "en"),
  );
}

function openQuestions(input: {
  status: string;
  voteCount: number;
  insights: RequestBriefInsight[];
  comments: RequestBriefComment[];
  tags: string[];
  releases: RequestBriefRelease[];
}): string[] {
  const questions: string[] = [];

  if (input.insights.length === 0) {
    questions.push(
      "No customer quotes are recorded. What did customers say, in their own words?",
    );
  }
  if (input.comments.length === 0) {
    questions.push(
      "No public discussion yet. What would a good solution look like to the people who voted?",
    );
  }
  if (input.voteCount === 0) {
    questions.push("No votes are recorded. Who is asking for this, and how often?");
  }
  if (input.releases.length === 0) {
    questions.push("No release is linked. Which milestone should this ship in?");
  }
  if (input.tags.length === 0) {
    questions.push("No tags yet. Which theme or segment does this request belong to?");
  }
  if (input.status === "open" || input.status === "under_review") {
    const label = REQUEST_BRIEF_STATUS_LABELS[input.status] ?? input.status;
    questions.push(`This is still ${label}. Has it been triaged and scoped?`);
  }

  questions.push("What is explicitly out of scope for a first version?");
  questions.push("How will we know this worked after it ships?");

  return questions;
}

export function buildRequestBrief(input: RequestBriefInput): string {
  const title = oneLine(input.title) || "Untitled request";
  const evidence = evidenceItems(input);
  const tags = [...new Set(input.tags.map(oneLine).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const releases = [...input.releases].sort(
    (a, b) =>
      time(a.publishedAt) - time(b.publishedAt) ||
      oneLine(a.title).localeCompare(oneLine(b.title), "en"),
  );
  const segments = segmentCounts(input.voters);
  const statusLabel = REQUEST_BRIEF_STATUS_LABELS[input.status] ?? input.status;
  const categoryLabel = REQUEST_BRIEF_CATEGORY_LABELS[input.category] ?? input.category;

  const lines: string[] = [];

  lines.push(`# ${title}`, "");
  lines.push(
    `Request brief for **${oneLine(input.productName)}** · workspace \`${oneLine(
      input.workspaceSlug,
    )}\` · request \`${input.requestId}\`.`,
    "",
  );

  lines.push("## Problem", "");
  lines.push(input.body.trim() || "_No description was provided._", "");

  lines.push("## Evidence", "");
  if (evidence.length === 0) {
    lines.push("_No customer quotes or public comments recorded yet._", "");
  } else {
    for (const item of evidence) {
      lines.push(`- **${day(item.at)}** · ${item.attribution}`);
      for (const line of item.quote.replace(/\r\n/g, "\n").split("\n")) {
        lines.push(`  > ${line}`.trimEnd());
      }
    }
    lines.push("");
  }

  lines.push("## Demand", "");
  lines.push(
    input.voteCount === 0
      ? "No votes are recorded yet."
      : `Votes: ${input.voteCount} (customer votes ${input.voters.length}, team votes ${
          input.teamVoteCount
        }, imported ${input.importedVoteCount}).`,
    "",
  );
  if (segments.length === 0) {
    lines.push("No customer segments are recorded as voters.", "");
  } else {
    lines.push("Segments:", "");
    for (const segment of segments) {
      lines.push(`- ${segment.label} — ${plural(segment.count, "customer")}`);
    }
    lines.push("");
  }

  lines.push("## Current status", "");
  lines.push(`- Status: ${statusLabel}`);
  lines.push(`- Category: ${categoryLabel}`);
  lines.push(`- Board: ${oneLine(input.boardName ?? "") || "No board"}`);
  lines.push(`- Tags: ${tags.join(", ") || "none"}`);
  lines.push(
    `- Linked releases: ${
      releases.length === 0
        ? "none"
        : releases
            .map(
              (release) =>
                `"${oneLine(release.title)}" (${release.status}${
                  release.publishedAt ? `, ${day(release.publishedAt)}` : ""
                })`,
            )
            .join("; ")
    }`,
  );
  lines.push(`- Created: ${day(input.createdAt)}`);
  lines.push(`- Updated: ${day(input.updatedAt)}`, "");

  lines.push("## Open questions", "");
  for (const question of openQuestions({
    status: input.status,
    voteCount: input.voteCount,
    insights: input.insights.filter((insight) => insight.quote.trim().length > 0),
    comments: input.comments.filter(
      (comment) => comment.internal !== true && comment.body.trim().length > 0,
    ),
    tags,
    releases,
  })) {
    lines.push(`- ${question}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
