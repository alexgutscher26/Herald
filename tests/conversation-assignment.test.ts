import { describe, expect, test } from "bun:test";

import { pickLeastLoaded } from "@/features/conversations/assignment";

describe("workload-based conversation assignment", () => {
  test("picks the operator with the fewest active conversations", () => {
    expect(
      pickLeastLoaded([
        { id: "a", name: "Ada", active: 4, lastSeenAt: 10 },
        { id: "b", name: "Ben", active: 1, lastSeenAt: 5 },
        { id: "c", name: "Cy", active: 2, lastSeenAt: 20 },
      ])?.id,
    ).toBe("b");
  });

  test("breaks a tie by the most recent heartbeat, then name", () => {
    expect(
      pickLeastLoaded([
        { id: "a", name: "Ada", active: 2, lastSeenAt: 100 },
        { id: "b", name: "Ben", active: 2, lastSeenAt: 300 },
      ])?.id,
    ).toBe("b");

    expect(
      pickLeastLoaded([
        { id: "a", name: "Ada", active: 2, lastSeenAt: null },
        { id: "b", name: "Ben", active: 2, lastSeenAt: null },
      ])?.id,
    ).toBe("a");
  });

  test("returns null when nobody is eligible", () => {
    expect(pickLeastLoaded([])).toBeNull();
  });

  test("does not mutate the caller's list", () => {
    const candidates = [
      { id: "a", name: "Ada", active: 3, lastSeenAt: null },
      { id: "b", name: "Ben", active: 1, lastSeenAt: null },
    ];
    pickLeastLoaded(candidates);
    expect(candidates.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  });
});
