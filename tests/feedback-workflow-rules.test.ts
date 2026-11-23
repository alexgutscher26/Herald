import { describe, expect, test } from "bun:test";

import {
  REPLY_SLA_DAYS,
  PLANNED_STALE_DAYS,
  isAwaitingReply,
  isPlannedAndStale,
  matchesAttention,
} from "@/features/feedback/attention";
import { normalizeViewFilters } from "@/features/feedback/saved-view-filters";

/**
 * Attention views are what turn "we have 200 requests" into "answer these
 * today". The rules are pure so the list and a saved view agree, and the
 * distinction between a public reply and an internal note is the whole point:
 * a note does not mean the customer was answered.
 */

const NOW = new Date("2026-11-21T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

describe("isAwaitingReply", () => {
  test("flags a request older than the SLA when nobody has replied", () => {
    expect(
      isAwaitingReply(
        { status: "new", createdAt: daysAgo(REPLY_SLA_DAYS + 1), lastTeamReplyAt: null },
        NOW,
      ),
    ).toBe(true);
  });

  test("does not flag a request inside the window", () => {
    expect(
      isAwaitingReply(
        { status: "new", createdAt: daysAgo(REPLY_SLA_DAYS - 1), lastTeamReplyAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  test("counts the last team reply, not the creation date", () => {
    expect(
      isAwaitingReply(
        {
          status: "under_review",
          createdAt: daysAgo(40),
          lastTeamReplyAt: daysAgo(2),
        },
        NOW,
      ),
    ).toBe(false);
  });

  test("ignores finished requests", () => {
    for (const status of ["shipped", "closed"] as const) {
      expect(
        isAwaitingReply(
          { status, createdAt: daysAgo(90), lastTeamReplyAt: null },
          NOW,
        ),
      ).toBe(false);
    }
  });
});

describe("isPlannedAndStale", () => {
  test("flags planned work untouched for the stale window", () => {
    expect(
      isPlannedAndStale(
        { status: "planned", updatedAt: daysAgo(PLANNED_STALE_DAYS + 1) },
        NOW,
      ),
    ).toBe(true);
  });

  test("does not flag recent planned work or another status", () => {
    expect(
      isPlannedAndStale({ status: "planned", updatedAt: daysAgo(3) }, NOW),
    ).toBe(false);
    expect(
      isPlannedAndStale(
        { status: "in_progress", updatedAt: daysAgo(PLANNED_STALE_DAYS + 1) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("matchesAttention", () => {
  const fresh = {
    status: "new" as const,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    lastTeamReplyAt: null,
  };

  test("treats \"all\" as no filter", () => {
    expect(matchesAttention(fresh, "all", NOW)).toBe(true);
  });

  test("routes each view to its own rule", () => {
    expect(matchesAttention(fresh, "no_reply_7d", NOW)).toBe(false);
    expect(matchesAttention(fresh, "planned_stale_30d", NOW)).toBe(false);
  });
});

describe("saved view filters", () => {
  test("defaults assignee and attention for views saved before they existed", () => {
    const filters = normalizeViewFilters({ search: "sso", status: "planned" });
    expect(filters.assignee).toBe("all");
    expect(filters.stale).toBe("all");
  });

  test("keeps assignee ids and valid attention values", () => {
    const filters = normalizeViewFilters({
      assignee: "usr_abc",
      stale: "no_reply_7d",
    });
    expect(filters.assignee).toBe("usr_abc");
    expect(filters.stale).toBe("no_reply_7d");
  });

  test("falls back to unfiltered values for junk", () => {
    const filters = normalizeViewFilters({
      assignee: "   ",
      stale: "whenever",
    });
    expect(filters.assignee).toBe("all");
    expect(filters.stale).toBe("all");
  });
});
