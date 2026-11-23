import { describe, expect, test } from "bun:test";

import {
  ROADMAP_PROMPT_THRESHOLDS,
  getRoadmapPrompt,
} from "@/features/roadmap/prompts";

/**
 * The roadmap prompt is a pure decision over status, age and votes. These
 * tests pin the exact boundaries so a later thresholds change is deliberate.
 */

const NOW = new Date("2026-06-01T12:00:00Z");
const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

describe("roadmap workflow prompts", () => {
  test("Planned becomes stale at the configured boundary", () => {
    const stale = getRoadmapPrompt(
      {
        status: "planned",
        updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.plannedStaleDays),
        votes: 20,
      },
      NOW,
    );

    expect(stale?.kind).toBe("stale_planned");
    expect(stale?.message).toContain("45 days");
    expect(stale?.suggestedAction).toContain("re-scope");

    expect(
      getRoadmapPrompt(
        {
          status: "planned",
          updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.plannedStaleDays - 1),
          votes: 20,
        },
        NOW,
      ),
    ).toBeNull();
  });

  test("In progress goes stale sooner than Planned", () => {
    const stale = getRoadmapPrompt(
      {
        status: "in_progress",
        updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.inProgressStaleDays),
        votes: 4,
      },
      NOW,
    );

    expect(stale?.kind).toBe("stale_in_progress");
    expect(stale?.message).toContain("21 days");

    expect(
      getRoadmapPrompt(
        {
          status: "in_progress",
          updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.inProgressStaleDays - 1),
          votes: 4,
        },
        NOW,
      ),
    ).toBeNull();
  });

  test("Under review prompts only while traction is low", () => {
    const low = getRoadmapPrompt(
      {
        status: "under_review",
        updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.lowTractionReviewDays),
        votes: ROADMAP_PROMPT_THRESHOLDS.lowTractionVotes,
      },
      NOW,
    );

    expect(low?.kind).toBe("low_traction_review");
    expect(low?.message).toContain("2 votes");
    expect(low?.suggestedAction).toContain("merge");

    expect(
      getRoadmapPrompt(
        {
          status: "under_review",
          updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.lowTractionReviewDays),
          votes: ROADMAP_PROMPT_THRESHOLDS.lowTractionVotes + 1,
        },
        NOW,
      ),
    ).toBeNull();

    expect(
      getRoadmapPrompt(
        {
          status: "under_review",
          updatedAt: daysAgo(ROADMAP_PROMPT_THRESHOLDS.lowTractionReviewDays - 1),
          votes: 0,
        },
        NOW,
      ),
    ).toBeNull();
  });

  test("singular vote copy and other statuses stay quiet", () => {
    const low = getRoadmapPrompt(
      { status: "under_review", updatedAt: daysAgo(30), votes: 1 },
      NOW,
    );
    expect(low?.message).toContain("1 vote.");

    expect(
      getRoadmapPrompt({ status: "new", updatedAt: daysAgo(90), votes: 0 }, NOW),
    ).toBeNull();
    expect(
      getRoadmapPrompt({ status: "shipped", updatedAt: daysAgo(90), votes: 0 }, NOW),
    ).toBeNull();
    expect(
      getRoadmapPrompt({ status: "closed", updatedAt: daysAgo(90), votes: 0 }, NOW),
    ).toBeNull();
  });

  test("a future or malformed timestamp produces no prompt", () => {
    expect(
      getRoadmapPrompt(
        {
          status: "planned",
          updatedAt: new Date(NOW.getTime() + DAY_MS).toISOString(),
          votes: 0,
        },
        NOW,
      ),
    ).toBeNull();
    expect(
      getRoadmapPrompt(
        { status: "planned", updatedAt: "not-a-date", votes: 0 },
        NOW,
      ),
    ).toBeNull();
  });
});
