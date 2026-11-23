import type { ReleaseCategory } from "@/types";

/**
 * Recurring release formats.
 *
 * Templates are plain copy, not database rows: applying one fills the editor
 * with a structure the author can edit, and nothing is saved until the normal
 * draft flow runs. Dates are derived from the moment the template is applied.
 */

export type ReleaseTemplateId =
  | "weekly-digest"
  | "monthly-roundup"
  | "feature-launch"
  | "fixes-and-improvements";

export type ReleaseTemplate = {
  title: string;
  summary: string;
  body: string;
  category: ReleaseCategory;
  tags: string[];
};

export type ReleaseTemplateSummary = {
  id: ReleaseTemplateId;
  name: string;
  description: string;
};

export const RELEASE_TEMPLATE_SUMMARIES: ReleaseTemplateSummary[] = [
  {
    id: "weekly-digest",
    name: "Weekly digest",
    description: "Shipped work, improvements and what is next.",
  },
  {
    id: "monthly-roundup",
    name: "Monthly roundup",
    description: "A broader recap grouped by theme.",
  },
  {
    id: "feature-launch",
    name: "Feature launch",
    description: "Problem, what changed and how to try it.",
  },
  {
    id: "fixes-and-improvements",
    name: "Fixes & improvements",
    description: "A short batch of quality-of-life changes.",
  },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function startOfWeek(date: Date): Date {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function weekLabel(date: Date): string {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startLabel = `${SHORT_MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const endLabel =
    start.getUTCMonth() === end.getUTCMonth()
      ? String(end.getUTCDate())
      : `${SHORT_MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${startLabel}–${endLabel}, ${end.getUTCFullYear()}`;
}

export function buildReleaseTemplate(
  id: ReleaseTemplateId,
  input: { productName: string; date?: Date },
): ReleaseTemplate {
  const date = input.date ?? new Date();
  const product = input.productName.trim() || "the product";

  switch (id) {
    case "weekly-digest":
      return {
        title: `Weekly digest · ${weekLabel(date)}`,
        summary: `A short recap of what shipped in ${product} this week and what is coming next.`,
        category: "improvement",
        tags: ["weekly-digest"],
        body: [
          `## Shipped this week`,
          "",
          "- **Change one** — what changed and why it matters.",
          "- **Change two** — the customer benefit, not the internal detail.",
          "",
          "## Improvements",
          "",
          "- Smaller fixes, performance work or polish worth mentioning.",
          "",
          "## Coming next",
          "",
          "- One or two things the team is actively working on.",
          "",
          "## Thanks",
          "",
          "Thanks to everyone who shared feedback. Reply or vote on the linked requests if you want to shape what comes next.",
        ].join("\n"),
      };
    case "monthly-roundup":
      return {
        title: `Monthly roundup · ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
        summary: `The most useful changes in ${product} from the past month, grouped by theme.`,
        category: "improvement",
        tags: ["monthly-roundup"],
        body: [
          "## Highlights",
          "",
          "- The headline change of the month and the customer problem it solves.",
          "",
          "## By theme",
          "",
          "### Faster everyday work",
          "",
          "- Improvements that remove friction.",
          "",
          "### Visibility and control",
          "",
          "- Settings, reporting or workflow changes.",
          "",
          "## What is next",
          "",
          "- The next theme the team is investing in.",
        ].join("\n"),
      };
    case "feature-launch":
      return {
        title: "Introducing ",
        summary: `A new capability in ${product} that helps customers get more done with less work.`,
        category: "feature",
        tags: ["launch"],
        body: [
          "## The problem",
          "",
          "Describe the customer problem in their words, without internal jargon.",
          "",
          "## What changed",
          "",
          "- The new capability and where to find it.",
          "- The most important behaviour or limit.",
          "",
          "## How to try it",
          "",
          "1. Open the relevant area of the product.",
          "2. Follow the short path to the new capability.",
          "",
          "## Why it matters",
          "",
          "Close with the outcome for the customer, not a feature list.",
        ].join("\n"),
      };
    case "fixes-and-improvements":
      return {
        title: "Fixes and improvements",
        summary: `A batch of small but useful fixes and polish across ${product}.`,
        category: "fix",
        tags: ["fixes"],
        body: [
          "## Fixed",
          "",
          "- The bug and the situation where it appeared.",
          "- Another fix, described by its visible effect.",
          "",
          "## Improved",
          "",
          "- A small workflow, performance or accessibility improvement.",
          "",
          "## Notes",
          "",
          "- Anything customers should know about behaviour changes or limits.",
        ].join("\n"),
      };
  }
}
