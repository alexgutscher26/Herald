import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  emailSuppressions,
  feedbackFollowers,
  notificationDeliveries,
  releases,
  subscribers,
} from "@/db/schema";
import { normalizeEmail } from "@/lib/email";
import { loadReleaseAudiencePreview } from "@/features/releases/audience";
import { createReleaseDraft, updateReleaseDraft } from "@/features/releases/draft-service";
import {
  ensureInitialRevision,
  listReleaseRevisions,
  loadReleaseSnapshot,
  recordReleaseRevision,
  restoreReleaseRevision,
} from "@/features/releases/revision-service";

import {
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createRelease,
  createReleaseFeedbackLink,
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

describe("release revisions", () => {
  isolatedTest("captures a baseline, dedupes unchanged saves and scopes reads", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const otherProduct = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "editor" });
    const release = await createRelease({
      productId: product.id,
      title: "Original title",
      slug: "original-title",
      status: "draft",
      authorIds: [user.id],
      tagNames: ["search"],
    });

    const { initial, second } = await db.transaction(async (tx) => {
      expect(
        await ensureInitialRevision(tx, { productId: product.id, releaseId: release.id }),
      ).toBe(true);
      expect(
        await ensureInitialRevision(tx, { productId: product.id, releaseId: release.id }),
      ).toBe(false);

      const initialSnapshot = await loadReleaseSnapshot(tx, product.id, release.id);
      expect(initialSnapshot?.title).toBe("Original title");
      expect(initialSnapshot?.tags).toEqual(["search"]);

      await tx
        .update(releases)
        .set({ title: "Updated title" })
        .where(eq(releases.id, release.id));

      const updated = await loadReleaseSnapshot(tx, product.id, release.id);
      if (!updated) throw new Error("Expected the release snapshot to exist.");

      expect(
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: release.id,
          action: "autosave",
          createdBy: user.id,
          snapshot: updated,
        }),
      ).toBe(true);
      expect(
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: release.id,
          action: "autosave",
          createdBy: user.id,
          snapshot: updated,
        }),
      ).toBe(false);

      // Tag casing is normalized for deduplication, not treated as an edit.
      expect(
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: release.id,
          action: "autosave",
          createdBy: user.id,
          snapshot: { ...updated, tags: ["Search"] },
        }),
      ).toBe(false);

      return { initial: initialSnapshot, second: updated };
    });

    expect(initial?.title).toBe("Original title");
    expect(second?.title).toBe("Updated title");

    const history = await listReleaseRevisions(product.id, release.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.title).toBe("Updated title");
    expect(history[0]?.action).toBe("autosave");
    expect(history[0]?.createdByName).toBe(user.name);
    expect(history[1]?.title).toBe("Original title");

    // A product id from the same workspace must not read this release.
    expect(await listReleaseRevisions(otherProduct.id, release.id)).toEqual([]);
    expect(await listReleaseRevisions(product.id, crypto.randomUUID())).toEqual([]);
  });

  isolatedTest("the changelog API draft path records its writes", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "editor" });

    const created = await createReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      {
        title: "API draft",
        slug: "api-draft",
        summary: "Created through the API.",
        body: "### What changed\n\nCreated through the API.",
        translations: {
          es: {
            title: "Borrador de API",
            summary: "Creado a través de la API.",
            body: "### Qué cambió\n\nCreado a través de la API.",
          },
        },
        tags: ["api"],
        authorIds: [user.id],
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await listReleaseRevisions(product.id, created.releaseId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      action: "save",
      status: "draft",
      title: "API draft",
      translations: {
        es: { title: "Borrador de API" },
      },
    });

    const updated = await updateReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      created.releaseId,
      { title: "API draft updated" },
    );
    expect(updated.ok).toBe(true);

    const second = await listReleaseRevisions(product.id, created.releaseId);
    expect(second).toHaveLength(2);
    expect(second[0]).toMatchObject({ action: "save", title: "API draft updated" });
  });

  isolatedTest("consecutive autosaves by one editor coalesce into one entry", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "editor" });
    const release = await createRelease({
      productId: product.id,
      title: "Start",
      status: "draft",
      authorIds: [user.id],
    });

    await db.transaction(async (tx) => {
      await ensureInitialRevision(tx, { productId: product.id, releaseId: release.id });

      for (const title of ["First edit", "Second edit"]) {
        await tx.update(releases).set({ title }).where(eq(releases.id, release.id));
        const snapshot = await loadReleaseSnapshot(tx, product.id, release.id);
        if (!snapshot) throw new Error("Expected the release snapshot to exist.");
        expect(
          await recordReleaseRevision(tx, {
            productId: product.id,
            releaseId: release.id,
            action: "autosave",
            createdBy: user.id,
            snapshot,
          }),
        ).toBe(true);
      }
    });

    const history = await listReleaseRevisions(product.id, release.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ title: "Second edit", action: "autosave" });
    expect(history[1]).toMatchObject({ title: "Start", action: "save" });
  });

  isolatedTest("a status-only publish records a revision even when content is unchanged", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const release = await createRelease({
      productId: product.id,
      status: "draft",
      authorIds: [user.id],
    });

    await db.transaction(async (tx) => {
      await ensureInitialRevision(tx, { productId: product.id, releaseId: release.id });
      await tx
        .update(releases)
        .set({ status: "published", publishedAt: new Date("2026-03-01T12:00:00Z") })
        .where(eq(releases.id, release.id));
      const snapshot = await loadReleaseSnapshot(tx, product.id, release.id);
      if (!snapshot) throw new Error("Expected the release snapshot to exist.");
      expect(
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: release.id,
          action: "publish",
          createdBy: user.id,
          snapshot,
        }),
      ).toBe(true);
    });

    const history = await listReleaseRevisions(product.id, release.id);
    expect(history.map((revision) => revision.status)).toEqual(["published", "draft"]);
    expect(history[0]?.publishedAt).toBe("2026-03-01T12:00:00.000Z");
  });

  isolatedTest("restores a revision in place and keeps the publication state", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "editor" });
    const translations = {
      es: {
        title: "Título original",
        summary: "Resumen original.",
        body: "### Qué cambió\n\nContenido original.",
      },
    };
    const release = await createRelease({
      productId: product.id,
      title: "Original title",
      status: "published",
      publishedAt: new Date("2026-03-01T12:00:00Z"),
      authorIds: [user.id],
      translations,
    });

    await db.transaction(async (tx) => {
      await ensureInitialRevision(tx, { productId: product.id, releaseId: release.id });
      await tx
        .update(releases)
        .set({
          title: "Changed title",
          bodyMarkdown: "### What changed\n\nChanged body.",
          translations: {},
        })
        .where(eq(releases.id, release.id));
      const changed = await loadReleaseSnapshot(tx, product.id, release.id);
      if (!changed) throw new Error("Expected the changed snapshot.");
      await recordReleaseRevision(tx, {
        productId: product.id,
        releaseId: release.id,
        action: "autosave",
        createdBy: user.id,
        snapshot: changed,
      });
    });

    const beforeRestore = await listReleaseRevisions(product.id, release.id);
    const original = beforeRestore.find((revision) => revision.title === "Original title");
    if (!original) throw new Error("Expected the original revision.");

    const restored = await restoreReleaseRevision({
      productId: product.id,
      workspaceId: workspace.id,
      releaseId: release.id,
      revisionId: original.id,
      userId: user.id,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    expect(restored.snapshot).toMatchObject({
      title: "Original title",
      body: "### What changed\n\nA small but useful update.",
      translations,
      status: "published",
      publishedAt: "2026-03-01T12:00:00.000Z",
    });

    const rows = await db.select().from(releases).where(eq(releases.id, release.id));
    expect(rows[0]).toMatchObject({
      title: "Original title",
      status: "published",
      translations,
    });
    expect(rows[0]?.publishedAt?.toISOString()).toBe("2026-03-01T12:00:00.000Z");

    const afterRestore = await listReleaseRevisions(product.id, release.id);
    expect(afterRestore[0]).toMatchObject({ action: "restore", title: "Original title" });
  });
});

describe("release audience preview", () => {
  isolatedTest("separates recipients, suppressions, unsubscribes and pending rows", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const release = await createRelease({ productId: product.id, status: "draft" });
    const request = await createFeedbackPost({
      productId: product.id,
      title: "Make search faster",
    });
    await createReleaseFeedbackLink({
      productId: product.id,
      releaseId: release.id,
      feedbackPostId: request.id,
    });
    const follower = await createCustomer(workspace.id, {
      email: "follower@example.test",
    });
    await db.insert(feedbackFollowers).values({
      feedbackPostId: request.id,
      customerId: follower.id,
    });

    const rows = [
      ["follower@example.test", "active", "follower"],
      ["manual@example.test", "active", "manual"],
      ["bounced@example.test", "active", "import"],
      ["gone@example.test", "unsubscribed", "widget"],
      ["pending@example.test", "pending", "follower"],
    ] as const;
    await db.insert(subscribers).values(
      rows.map(([email, status, source]) => ({
        productId: product.id,
        email,
        emailNormalized: normalizeEmail(email),
        status,
        source,
      })),
    );
    await db.insert(emailSuppressions).values({
      workspaceId: workspace.id,
      email: "bounced@example.test",
      emailNormalized: normalizeEmail("bounced@example.test"),
      reason: "hard_bounce",
      note: "Mailbox does not exist.",
    });

    const preview = await loadReleaseAudiencePreview({
      workspaceId: workspace.id,
      productId: product.id,
      linkedFeedbackIds: [request.id],
      tagSlugs: [],
      emailEnabled: true,
    });

    expect(preview.eligible).toBe(2);
    expect(preview.suppressed).toBe(1);
    expect(preview.unsubscribed).toBe(1);
    expect(preview.pending).toBe(1);
    expect(preview.totalSubscribers).toBe(5);
    expect(preview.suppressedByReason.hard_bounce).toBe(1);
    expect(preview.followersInAudience).toBe(1);
    expect(preview.recipients.map((recipient) => recipient.email).sort()).toEqual([
      "follower@example.test",
      "manual@example.test",
    ]);
    expect(
      preview.recipients.find((recipient) => recipient.email === "follower@example.test"),
    ).toMatchObject({ name: null, source: "follower", followsLinkedRequest: true });
    expect(preview.suppressedAddresses[0]).toMatchObject({
      email: "bounced@example.test",
      reason: "hard_bounce",
      note: "Mailbox does not exist.",
    });

    // A preview must never queue an outbox row.
    expect(await db.select({ id: notificationDeliveries.id }).from(notificationDeliveries)).toEqual(
      [],
    );
  });

  isolatedTest("suppression is workspace-scoped", async () => {
    const workspace = await createWorkspace();
    const otherWorkspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    await db.insert(subscribers).values({
      productId: product.id,
      email: "shared@example.test",
      emailNormalized: normalizeEmail("shared@example.test"),
      status: "active",
      source: "manual",
    });
    await db.insert(emailSuppressions).values({
      workspaceId: otherWorkspace.id,
      email: "shared@example.test",
      emailNormalized: normalizeEmail("shared@example.test"),
      reason: "manual",
    });

    const preview = await loadReleaseAudiencePreview({
      workspaceId: workspace.id,
      productId: product.id,
      linkedFeedbackIds: [],
      tagSlugs: [],
      emailEnabled: true,
    });
    expect(preview.eligible).toBe(1);
    expect(preview.suppressed).toBe(0);
  });
});
