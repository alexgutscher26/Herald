import { describe, expect, test } from "bun:test";

import { buildDeliveryDedupeKey } from "@/db/schema/notifications";
import { releaseFormSchema } from "@/features/releases/release-schema";

const validRelease = {
  title: "Live test release",
  slug: "live-test-release",
  summary: "A summary that is long enough.",
  body: "A release body long enough to pass validation.",
  category: "feature" as const,
  tagsText: "API, mobile",
  authorIds: ["usr_author"],
  youtubeUrl: "",
  cover: { kind: "none" as const },
  ogImage: null,
  channels: {
    publicChangelog: true,
    inAppWidget: false,
    subscriberEmail: false,
  },
  linkedFeedbackIds: [],
  linkedCancellationReasonIds: [],
  publishMode: "now" as const,
  scheduledFor: "",
};

describe("releaseFormSchema", () => {
  test("accepts a complete release", () => {
    const result = releaseFormSchema.safeParse(validRelease);
    expect(result.success).toBe(true);
  });

  test("trims whitespace from the title and summary", () => {
    const result = releaseFormSchema.safeParse({
      ...validRelease,
      title: "  Trimmed release  ",
      summary: "  A summary that is long enough.  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Trimmed release");
      expect(result.data.summary).toBe("A summary that is long enough.");
    }
  });

  test("rejects a slug that is already formatted incorrectly", () => {
    const result = releaseFormSchema.safeParse({
      ...validRelease,
      slug: "Not A Slug",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((candidate) => candidate.path[0] === "slug");
      expect(issue).toBeDefined();
    }
  });

  test("requires at least one distribution channel", () => {
    const result = releaseFormSchema.safeParse({
      ...validRelease,
      channels: {
        publicChangelog: false,
        inAppWidget: false,
        subscriberEmail: false,
      },
    });
    expect(result.success).toBe(false);
  });

  test("accepts only YouTube links and requires an author", () => {
    expect(
      releaseFormSchema.safeParse({
        ...validRelease,
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }).success,
    ).toBe(true);
    expect(
      releaseFormSchema.safeParse({
        ...validRelease,
        youtubeUrl: "https://example.com/watch?v=dQw4w9WgXcQ",
      }).success,
    ).toBe(false);
    expect(releaseFormSchema.safeParse({ ...validRelease, authorIds: [] }).success).toBe(
      false,
    );
  });

  test("rejects a short body and an overlong summary", () => {
    expect(releaseFormSchema.safeParse({ ...validRelease, body: "too short" }).success).toBe(false);
    expect(
      releaseFormSchema.safeParse({ ...validRelease, summary: "a".repeat(281) }).success,
    ).toBe(false);
  });
});

describe("buildDeliveryDedupeKey", () => {
  test("is stable for the same logical message", () => {
    const input = {
      template: "release_published" as const,
      productId: "prod_1",
      recipientEmailNormalized: "customer@example.com",
      sourceId: "rel_1",
    };
    expect(buildDeliveryDedupeKey(input)).toBe(buildDeliveryDedupeKey({ ...input }));
  });

  test("varies by recipient and source so distinct deliveries never collide", () => {
    const base = {
      template: "release_published" as const,
      productId: "prod_1",
      recipientEmailNormalized: "customer@example.com",
      sourceId: "rel_1",
    };
    const keys = new Set([
      buildDeliveryDedupeKey(base),
      buildDeliveryDedupeKey({ ...base, recipientEmailNormalized: "other@example.com" }),
      buildDeliveryDedupeKey({ ...base, sourceId: "rel_2" }),
      buildDeliveryDedupeKey({ ...base, template: "winback_campaign" }),
      buildDeliveryDedupeKey({ ...base, productId: "prod_2" }),
    ]);
    expect(keys.size).toBe(5);
  });
});
