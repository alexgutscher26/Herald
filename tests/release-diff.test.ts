import { describe, expect, test } from "bun:test";

import {
  changedFieldLabels,
  diffReleaseSnapshots,
  wordDiff,
} from "@/features/releases/release-diff";
import {
  findPublicationRevision,
  type ReleaseRevisionSnapshot,
  type ReleaseRevisionView,
} from "@/features/releases/revision-types";

const BASE: ReleaseRevisionSnapshot = {
  title: "Faster search",
  slug: "faster-search",
  summary: "Search is faster.",
  body: "### What changed\n\nSearch is twice as fast.",
  translations: {},
  category: "improvement",
  cover: { kind: "preset", preset: "grid" },
  ogImageKey: null,
  youtubeUrl: null,
  channels: { publicChangelog: true, inAppWidget: true, subscriberEmail: false },
  tags: ["search"],
  authorIds: ["usr_ada"],
  linkedFeedbackIds: ["fdb_1"],
  linkedCancellationReasonIds: [],
  status: "draft",
  scheduledFor: null,
  publishedAt: null,
};

const CONTEXT = {
  timeZone: "UTC",
  authorName: (id: string) => (id === "usr_ada" ? "Ada Lovelace" : undefined),
  feedbackTitle: (id: string) => (id === "fdb_1" ? "Search is slow" : undefined),
  cancellationReason: () => undefined,
};

function revision(
  id: string,
  action: ReleaseRevisionView["action"],
  status: ReleaseRevisionView["status"],
): ReleaseRevisionView {
  return {
    ...BASE,
    id,
    action,
    status,
    createdById: null,
    createdByName: null,
    createdAt: "2026-03-01T12:00:00.000Z",
  };
}

describe("findPublicationRevision", () => {
  test("prefers an explicit publish marker over a newer published-status autosave", () => {
    const revisions = [
      revision("autosave", "autosave", "published"),
      revision("publish", "publish", "published"),
      revision("baseline", "save", "draft"),
    ];
    expect(findPublicationRevision(revisions)?.id).toBe("publish");
  });

  test("falls back to the oldest published snapshot for a pre-history release", () => {
    const revisions = [
      revision("autosave", "autosave", "published"),
      revision("baseline", "save", "published"),
    ];
    expect(findPublicationRevision(revisions)?.id).toBe("baseline");
  });

  test("returns null when nothing was ever published", () => {
    expect(
      findPublicationRevision([revision("draft", "save", "draft")]),
    ).toBeNull();
  });
});

describe("diffReleaseSnapshots", () => {
  test("returns no changes for identical snapshots", () => {
    expect(diffReleaseSnapshots(BASE, { ...BASE }, CONTEXT)).toEqual([]);
  });

  test("reports changed fields with formatted values", () => {
    const changes = diffReleaseSnapshots(
      BASE,
      {
        ...BASE,
        title: "Much faster search",
        tags: ["search", "performance"],
        authorIds: ["usr_ada", "usr_grace"],
      },
      {
        ...CONTEXT,
        authorName: (id) =>
          ({ usr_ada: "Ada Lovelace", usr_grace: "Grace Hopper" })[id],
      },
    );

    expect(changedFieldLabels(changes)).toEqual(["Title", "Tags", "Authors"]);
    expect(changes[0]).toMatchObject({
      before: "Faster search",
      after: "Much faster search",
    });
    expect(changes[2]?.after).toBe("Ada Lovelace, Grace Hopper");
  });

  test("diffs the body line by line and trims unchanged context", () => {
    const changes = diffReleaseSnapshots(
      BASE,
      {
        ...BASE,
        body: "### What changed\n\nSearch is four times as fast.\n\n- New index",
      },
      CONTEXT,
    );

    expect(changes.map((change) => change.field)).toEqual(["body"]);
    const body = changes[0]?.body;
    expect(body).toBeDefined();
    expect(body?.lines.some((line) => line.type === "added" && line.text.includes("four times"))).toBe(
      true,
    );
    expect(body?.lines.some((line) => line.type === "removed" && line.text.includes("twice"))).toBe(
      true,
    );
    expect(body?.lines.length).toBeGreaterThan(0);
    expect(body?.truncated).toBe(false);
    const removedLine = body?.lines.find(
      (line) => line.type === "removed" && line.text.includes("twice"),
    );
    const addedLine = body?.lines.find(
      (line) => line.type === "added" && line.text.includes("four times"),
    );
    expect(removedLine?.words?.some((word) => word.type === "removed" && word.text === "twice")).toBe(
      true,
    );
    expect(addedLine?.words?.some((word) => word.type === "added" && word.text === "four")).toBe(
      true,
    );
  });

  test("diffs words inside a changed line instead of replacing the whole line", () => {
    const tokens = wordDiff("Search is twice as fast.", "Search is four times as fast.");
    expect(tokens.filter((token) => token.type === "same").map((token) => token.text)).toContain(
      "Search",
    );
    expect(tokens.some((token) => token.type === "removed" && token.text === "twice")).toBe(true);
    expect(tokens.some((token) => token.type === "added" && token.text === "four")).toBe(true);
    expect(tokens.some((token) => token.type === "added" && token.text === "times")).toBe(true);
  });

  test("reports translation changes even when the base copy is unchanged", () => {
    const changes = diffReleaseSnapshots(
      BASE,
      {
        ...BASE,
        translations: {
          es: {
            title: "Búsqueda más rápida",
            summary: "La búsqueda es más rápida.",
            body: "La búsqueda es el doble de rápida.",
          },
        },
      },
      CONTEXT,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "translations",
      before: "No translations",
      after: "Español · Búsqueda más rápida",
    });
  });

  test("formats schedules in the workspace timezone", () => {
    const changes = diffReleaseSnapshots(
      { ...BASE, scheduledFor: "2026-03-01T15:00:00.000Z", status: "scheduled" },
      { ...BASE, scheduledFor: "2026-03-01T16:00:00.000Z", status: "scheduled" },
      { ...CONTEXT, timeZone: "America/New_York" },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe("scheduledFor");
    expect(changes[0]?.before).toContain("10:00 AM");
    expect(changes[0]?.after).toContain("11:00 AM");
  });

  test("describes channel, cover and link changes", () => {
    const changes = diffReleaseSnapshots(
      BASE,
      {
        ...BASE,
        cover: { kind: "custom", fingerprint: "custom-1" },
        channels: { publicChangelog: false, inAppWidget: true, subscriberEmail: true },
        linkedFeedbackIds: [],
      },
      CONTEXT,
    );

    expect(changedFieldLabels(changes)).toEqual([
      "Cover",
      "Distribution",
      "Linked feedback",
    ]);
    expect(changes.find((change) => change.field === "cover")?.after).toBe("Custom image");
    expect(changes.find((change) => change.field === "channels")?.after).toContain(
      "Subscriber email",
    );
    expect(changes.find((change) => change.field === "linkedFeedbackIds")?.after).toBe(
      "No linked requests",
    );
  });
});
