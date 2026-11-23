import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackFollowers } from "@/db/schema/feedback-extensions";
import { emailSuppressions } from "@/db/schema/email";
import { subscribers } from "@/db/schema/subscribers";
import {
  listAllSubscribers,
  listSubscribers,
  listSuppressions,
} from "@/db/queries/subscribers";
import { suppressEmail } from "@/features/email/suppressions";
import { parseSubscriberCsv, toSubscriberCsv } from "@/features/subscribers/csv";
import {
  getSubscriberPreferences,
  updateSubscriberPreferences,
} from "@/features/subscribers/preferences";
import { normalizeEmail } from "@/lib/email";
import {
  addSubscriber,
  importSubscribers,
  removeSuppressions as removeSubscriberSuppressions,
  setSubscriberStatus,
  syncFollowersToSubscribers,
} from "@/features/subscribers/service";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createProduct,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Subscriber management against real Postgres.
 *
 * The import is the operation most likely to corrupt an audience, so the test
 * checks the upsert, the preserved unsubscribe token and the product-scoped
 * reads a dashboard page uses.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function tenant() {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  return { workspace, product };
}

describe("subscriber import", () => {
  isolatedTest("creates rows, then updates status without rotating the token", async () => {
    const t = await tenant();
    const first = `${uniqueLabel("import-a")}@example.test`;
    const second = `${uniqueLabel("import-b")}@example.test`;

    const created = await importSubscribers({
      productId: t.product.id,
      rows: [
        {
          email: first,
          emailNormalized: normalizeEmail(first),
          name: "Ada",
          status: "active",
          source: "import",
        },
        {
          email: second,
          emailNormalized: normalizeEmail(second),
          name: null,
          status: "pending",
          source: "import",
        },
      ],
    });
    expect(created).toEqual({ created: 2, updated: 0, invalid: 0, total: 2 });

    const before = await db
      .select()
      .from(subscribers)
      .where(
        and(
          eq(subscribers.productId, t.product.id),
          eq(subscribers.emailNormalized, normalizeEmail(first)),
        ),
      );
    const originalToken = before[0]?.unsubscribeToken;
    expect(originalToken).toBeTruthy();

    const updated = await importSubscribers({
      productId: t.product.id,
      rows: [
        {
          email: first,
          emailNormalized: normalizeEmail(first),
          name: "Ada Lovelace",
          status: "unsubscribed",
          source: "import",
        },
      ],
    });
    expect(updated).toEqual({ created: 0, updated: 1, invalid: 0, total: 1 });

    const after = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, before[0]?.id ?? ""));
    expect(after[0]?.status).toBe("unsubscribed");
    expect(after[0]?.unsubscribedAt).not.toBeNull();
    expect(after[0]?.unsubscribeToken).toBe(originalToken);
    expect(after[0]?.name).toBe("Ada Lovelace");

    const list = await listSubscribers(
      t.product.id,
      { search: "import-a", status: "all", source: "all" },
      t.workspace.id,
    );
    expect(list.total).toBe(1);
    expect(list.rows[0]?.email).toBe(first);
    expect(list.counts.unsubscribed).toBe(1);
  });

  isolatedTest("rejects an invalid address at the service boundary", async () => {
    const t = await tenant();
    const result = await addSubscriber({
      productId: t.product.id,
      email: "not-an-address",
    });
    expect(result).toEqual({ ok: false, error: "Enter a valid email address." });
  });

  isolatedTest("an old export cannot silently reactivate an unsubscribed address", async () => {
    const t = await tenant();
    const email = `${uniqueLabel("optout")}@example.test`;
    const added = await addSubscriber({ productId: t.product.id, email });
    if (!added.ok) throw new Error("Could not add the fixture subscriber.");

    await setSubscriberStatus({
      productId: t.product.id,
      subscriberId: added.id,
      status: "unsubscribed",
    });
    const before = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, added.id));
    const unsubscribedAt = before[0]?.unsubscribedAt;
    expect(unsubscribedAt).not.toBeNull();

    const imported = await importSubscribers({
      productId: t.product.id,
      rows: [
        {
          email,
          emailNormalized: normalizeEmail(email),
          name: "Still out",
          status: "active",
          source: "import",
        },
      ],
    });
    expect(imported).toEqual({ created: 0, updated: 1, invalid: 0, total: 1 });

    const after = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, added.id));
    expect(after[0]?.status).toBe("unsubscribed");
    expect(after[0]?.unsubscribedAt).toEqual(unsubscribedAt);
    expect(after[0]?.unsubscribeToken).toBe(before[0]?.unsubscribeToken);
    expect(after[0]?.name).toBe("Still out");
  });

  isolatedTest("export round-trips every subscriber through the CSV parser", async () => {
    const t = await tenant();
    const active = `${uniqueLabel("export-active")}@example.test`;
    const gone = `${uniqueLabel("export-gone")}@example.test`;
    await importSubscribers({
      productId: t.product.id,
      rows: [
        {
          email: active,
          emailNormalized: normalizeEmail(active),
          name: "Ada",
          status: "active",
          source: "import",
        },
        {
          email: gone,
          emailNormalized: normalizeEmail(gone),
          name: null,
          status: "unsubscribed",
          source: "manual",
        },
      ],
    });

    const csv = toSubscriberCsv(await listAllSubscribers(t.product.id));
    const parsed = parseSubscriberCsv(csv);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.invalidRows).toBe(0);
    expect(parsed.rows.map((row) => row.email).sort()).toEqual([active, gone].sort());
    expect(parsed.rows.find((row) => row.email === active)).toMatchObject({
      name: "Ada",
      status: "active",
      source: "import",
    });
    expect(parsed.rows.find((row) => row.email === gone)).toMatchObject({
      name: null,
      status: "unsubscribed",
      source: "manual",
    });
  });
});

describe("subscriber status and suppressions", () => {
  isolatedTest("the preference token unsubscribes without deleting history", async () => {
    const t = await tenant();
    const email = `${uniqueLabel("preference")}@example.test`;
    const added = await addSubscriber({ productId: t.product.id, email });
    if (!added.ok) throw new Error("Could not add the fixture subscriber.");

    const [row] = await db
      .select({ token: subscribers.unsubscribeToken })
      .from(subscribers)
      .where(eq(subscribers.id, added.id));
    if (!row?.token) throw new Error("The subscriber has no preference token.");

    const preferences = await updateSubscriberPreferences(row.token, {
      productUpdates: false,
      winback: true,
    });
    expect(preferences?.productUpdates).toBe(false);
    expect(preferences?.weeklyDigest).toBe(false);

    const [after] = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, added.id));
    expect(after?.status).toBe("unsubscribed");
    expect(after?.unsubscribedAt).not.toBeNull();
    expect(await getSubscriberPreferences(row.token)).toMatchObject({
      productUpdates: false,
      winback: true,
    });
  });

  isolatedTest("unsubscribing keeps the row and suppress/unsuppress is workspace-scoped", async () => {
    const t = await tenant();
    const email = `${uniqueLabel("status")}@example.test`;
    const added = await addSubscriber({ productId: t.product.id, email });
    if (!added.ok) throw new Error("Could not add the fixture subscriber.");

    expect(
      await setSubscriberStatus({
        productId: t.product.id,
        subscriberId: added.id,
        status: "unsubscribed",
      }),
    ).toBe(true);

    const row = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, added.id));
    expect(row[0]?.status).toBe("unsubscribed");
    expect(row[0]?.unsubscribedAt).not.toBeNull();

    await suppressEmail({
      workspaceId: t.workspace.id,
      email,
      reason: "manual",
      note: "Customer asked",
    });
    const suppressions = await listSuppressions(t.workspace.id, "status");
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]?.email).toBe(email);

    const otherWorkspace = await createWorkspace();
    expect(
      await removeSubscriberSuppressions({
        workspaceId: otherWorkspace.id,
        ids: suppressions.map((item) => item.id),
      }),
    ).toBe(0);

    expect(
      await removeSubscriberSuppressions({
        workspaceId: t.workspace.id,
        ids: suppressions.map((item) => item.id),
      }),
    ).toBe(1);
    expect(
      await db
        .select({ id: emailSuppressions.id })
        .from(emailSuppressions)
        .where(eq(emailSuppressions.workspaceId, t.workspace.id)),
    ).toHaveLength(0);
  });
});

describe("follower sync", () => {
  isolatedTest("creates pending subscribers without opting them into the changelog", async () => {
    const t = await tenant();
    const board = await createBoard(t.product.id);
    const follower = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("follower")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: board.id,
      authorCustomerId: follower.id,
    });
    await db.insert(feedbackFollowers).values({
      feedbackPostId: post.id,
      customerId: follower.id,
      source: "board",
    });

    const result = await syncFollowersToSubscribers({
      workspaceId: t.workspace.id,
      productId: t.product.id,
    });
    expect(result).toEqual({ followers: 1, created: 1, linked: 1 });

    const rows = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.productId, t.product.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.source).toBe("follower");
    expect(rows[0]?.weeklyDigest).toBe(false);
    expect(rows[0]?.customerId).toBe(follower.id);

    const replay = await syncFollowersToSubscribers({
      workspaceId: t.workspace.id,
      productId: t.product.id,
    });
    expect(replay).toEqual({ followers: 1, created: 0, linked: 1 });
  });
});
