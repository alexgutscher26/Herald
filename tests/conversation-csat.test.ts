import { describe, expect, test } from "bun:test";

import {
  CSAT_RERATE_WINDOW_MS,
  csatEligibility,
  type CsatEligibilityRow,
} from "@/features/conversations/csat";

const REQUESTED = new Date("2026-01-01T12:00:00.000Z");
const RATED = new Date("2026-01-02T12:00:00.000Z");

function row(overrides: Partial<CsatEligibilityRow> = {}): CsatEligibilityRow {
  return {
    csatRequestedAt: REQUESTED,
    csatRating: null,
    csatRatedAt: null,
    csatReratedAt: null,
    resolvedAt: new Date("2026-01-02T12:00:00.000Z"),
    status: "resolved",
    ...overrides,
  };
}

describe("CSAT eligibility", () => {
  test("offers the first rating only on an eligible resolved thread", () => {
    expect(csatEligibility(row(), new Date("2026-01-03T12:00:00.000Z"))).toEqual({
      canRate: true,
      rerate: false,
    });
    expect(
      csatEligibility(row({ csatRequestedAt: null }), new Date("2026-01-03T12:00:00.000Z"))
        .canRate,
    ).toBe(false);
    expect(
      csatEligibility(row({ status: "open" }), new Date("2026-01-03T12:00:00.000Z")).canRate,
    ).toBe(false);
  });

  test("allows one re-rate after a later resolution inside seven days", () => {
    const resolvedAt = new Date(RATED.getTime() + 2 * 24 * 60 * 60 * 1000);
    const now = new Date(resolvedAt.getTime() + 24 * 60 * 60 * 1000);
    expect(
      csatEligibility(
        row({ csatRating: 2, csatRatedAt: RATED, resolvedAt }),
        now,
      ),
    ).toEqual({ canRate: true, rerate: true });
  });

  test("does not call a status re-save a reopen", () => {
    expect(
      csatEligibility(
        row({ csatRating: 3, csatRatedAt: RATED, resolvedAt: RATED }),
        new Date("2026-01-04T12:00:00.000Z"),
      ).canRate,
    ).toBe(false);
  });

  test("expires the update window and refuses a second re-rate", () => {
    const resolvedAt = new Date(RATED.getTime() + 24 * 60 * 60 * 1000);
    const expired = new Date(resolvedAt.getTime() + CSAT_RERATE_WINDOW_MS + 1);
    expect(
      csatEligibility(
        row({ csatRating: 3, csatRatedAt: RATED, resolvedAt }),
        expired,
      ).canRate,
    ).toBe(false);
    expect(
      csatEligibility(
        row({ csatRating: 3, csatRatedAt: RATED, resolvedAt, csatReratedAt: new Date() }),
        new Date(resolvedAt.getTime() + 60_000),
      ).canRate,
    ).toBe(false);
  });

  test("keeps the window open through its exact final millisecond", () => {
    const resolvedAt = new Date(RATED.getTime() + 24 * 60 * 60 * 1000);
    expect(
      csatEligibility(
        row({ csatRating: 4, csatRatedAt: RATED, resolvedAt }),
        new Date(resolvedAt.getTime() + CSAT_RERATE_WINDOW_MS),
      ).rerate,
    ).toBe(true);
  });
});