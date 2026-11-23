import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  notificationDeliveries,
  subscriberTopicPreferences,
  subscribers,
  subscriptionTopics,
} from "@/db/schema";
import {
  getPublicChangelogEntry,
  getPublicChangelogPage,
} from "@/features/public/changelog";
import { setReleaseReaction } from "@/features/public/release-engagement";
import { loadReleaseAudiencePreview } from "@/features/releases/audience";
import { queueReleaseDeliveries } from "@/features/releases/publish-effects";
import { ensureReleaseTagTopics } from "@/features/subscribers/subscription-topics";
import { releaseTagTopicKey } from "@/features/subscribers/topics";

import {
  createCustomer,
  createProduct,
  createRelease,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("changelog discovery", () => {
  isolatedTest("filters by tag and category, suggests related entries and stores reactions", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { publicChangelogEnabled: true });
    const search = await createRelease({
      productId: product.id,
      title: "Faster search",
      slug: "faster-search",
      category: "feature",
      tagNames: ["Search"],
    });
    const searchFollowUp = await createRelease({
      productId: product.id,
      title: "Search filters",
      slug: "search-filters",
      category: "improvement",
      tagNames: ["Search"],
    });
    const billing = await createRelease({
      productId: product.id,
      title: "Invoice fixes",
      slug: "invoice-fixes",
      category: "fix",
      tagNames: ["Billing"],
    });

    const tagPage = await getPublicChangelogPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      tagSlug: "search",
    });
    expect(tagPage?.filter).toEqual({ kind: "tag", tag: { name: "Search", slug: "search" } });
    expect(tagPage?.pagination.total).toBe(2);
    expect(tagPage?.entries.map((entry) => entry.slug)).not.toContain("invoice-fixes");

    const categoryPage = await getPublicChangelogPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      category: "fix",
    });
    expect(categoryPage?.filter).toEqual({ kind: "category", category: "fix" });
    expect(categoryPage?.entries.map((entry) => entry.id)).toEqual([billing.id]);

    const detail = await getPublicChangelogEntry({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      slug: search.slug,
    });
    expect(detail?.entry.related.map((entry) => entry.id)).toContain(searchFollowUp.id);
    expect(detail?.entry.related.map((entry) => entry.id)).not.toContain(search.id);

    const customer = await createCustomer(workspace.id, { email: "reader@example.test" });
    const first = await setReleaseReaction({
      productId: product.id,
      releaseId: search.id,
      customerId: customer.id,
      kind: "love",
      reacted: true,
    });
    expect(first).toEqual({ ok: true, reacted: true, count: 1 });
    await setReleaseReaction({
      productId: product.id,
      releaseId: search.id,
      customerId: customer.id,
      kind: "love",
      reacted: true,
    });

    const viewed = await getPublicChangelogEntry(
      {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: search.slug,
      },
      {
        customerId: customer.id,
        workspaceId: workspace.id,
        identified: true,
        hasCompany: false,
      },
    );
    expect(viewed?.entry.canReact).toBe(true);
    expect(viewed?.entry.reactions.find((reaction) => reaction.kind === "love")).toEqual({
      kind: "love",
      count: 1,
      reacted: true,
    });

    const removed = await setReleaseReaction({
      productId: product.id,
      releaseId: search.id,
      customerId: customer.id,
      kind: "love",
      reacted: false,
    });
    expect(removed).toEqual({ ok: true, reacted: false, count: 0 });

    expect(releaseTagTopicKey("search")).toBe("tag_search");
    await ensureReleaseTagTopics(product.id);
    const topics = await db
      .select({ key: subscriptionTopics.key, name: subscriptionTopics.name })
      .from(subscriptionTopics)
      .where(eq(subscriptionTopics.productId, product.id));
    expect(topics).toContainEqual({ key: "tag_search", name: "Tag: Search" });

    const tagTopic = await db
      .select({ id: subscriptionTopics.id })
      .from(subscriptionTopics)
      .where(eq(subscriptionTopics.key, "tag_search"))
      .limit(1);
    const [kept, muted] = await db
      .insert(subscribers)
      .values([
        {
          productId: product.id,
          email: "kept@example.test",
          emailNormalized: "kept@example.test",
          status: "active",
          source: "manual",
        },
        {
          productId: product.id,
          email: "muted@example.test",
          emailNormalized: "muted@example.test",
          status: "active",
          source: "manual",
        },
      ])
      .returning({ id: subscribers.id, email: subscribers.email });
    if (!tagTopic[0] || !kept || !muted) throw new Error("Expected tag topic and subscribers.");
    await db.insert(subscriberTopicPreferences).values({
      productId: product.id,
      subscriberId: muted.id,
      topicId: tagTopic[0].id,
      subscribed: false,
    });

    const audience = await loadReleaseAudiencePreview({
      workspaceId: workspace.id,
      productId: product.id,
      linkedFeedbackIds: [],
      tagSlugs: ["search"],
      emailEnabled: true,
    });
    expect(audience.eligible).toBe(1);
    expect(audience.mutedByTag).toBe(1);

    await db.transaction(async (tx) => {
      await queueReleaseDeliveries(tx, {
        workspaceId: workspace.id,
        productId: product.id,
        releaseId: search.id,
      });
    });
    const deliveries = await db
      .select({ email: notificationDeliveries.recipientEmail })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.releaseId, search.id));
    expect(deliveries).toEqual([{ email: kept.email }]);
  });
});