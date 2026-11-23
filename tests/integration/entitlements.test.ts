import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boards, workspaces } from "@/db/schema";
import {
  checkBoardLimit,
  checkWorkspaceLimit,
  countWorkspaceUsage,
  getWorkspaceEntitlements,
} from "@/features/entitlements/entitlements";

import {
  createBoard,
  createMember,
  createProduct,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Entitlements resolve the plan from the database and count actual rows, so
 * these tests use real workspaces, members and boards rather than mocks of the
 * query layer.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("workspace usage", () => {
  isolatedTest("counts products, members and unarchived boards", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    await createProduct(workspace.id);

    await createBoard(product.id);
    await createBoard(product.id, { archivedAt: new Date() });

    await createMember(workspace.id);
    await createMember(workspace.id, { role: "owner" });

    expect(await countWorkspaceUsage(workspace.id)).toEqual({
      products: 2,
      members: 2,
      viewers: 0,
      boards: 1,
      integrations: 0,
    });
  });

  isolatedTest("reports the plan, feature matrix and limits", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const entitlements = await getWorkspaceEntitlements(workspace.id);

    expect(entitlements.plan).toBe("pro");
    expect(entitlements.planName.length).toBeGreaterThan(0);
    expect(entitlements.features.publicFeedback).toBe(true);
    expect(entitlements.features.api).toBe(true);
    // Professional is unlimited, which the catalogue expresses as null rather
    // than a very large number; the settings screen renders it as "Unlimited".
    expect(entitlements.limits.products).toBeNull();
    expect(entitlements.limits.members).toBeGreaterThan(1);
  });
});

describe("limit gates", () => {
  isolatedTest("refuses the increment that would exceed the free product limit", async () => {
    const workspace = await createWorkspace();
    await createProduct(workspace.id);

    const blocked = await checkWorkspaceLimit(workspace.id, "products", 1);
    expect(blocked.plan).toBe("free");
    expect(blocked.allowed).toBe(false);
    expect(blocked.current).toBe(1);
    expect(blocked.remaining).toBe(0);

    await db.update(workspaces).set({ plan: "pro" }).where(eq(workspaces.id, workspace.id));

    const allowed = await checkWorkspaceLimit(workspace.id, "products", 1);
    expect(allowed.plan).toBe("pro");
    expect(allowed.allowed).toBe(true);
  });

  isolatedTest("refuses the third board and frees a slot when one is archived", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    const fixtureBoards = [
      await createBoard(product.id),
      await createBoard(product.id),
    ];

    const blocked = await checkBoardLimit(product.id, 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.current).toBe(2);

    const archived = fixtureBoards[0];
    if (!archived) throw new Error("Expected a fixture board.");
    await db.update(boards).set({ archivedAt: new Date() }).where(eq(boards.id, archived.id));

    const allowed = await checkBoardLimit(product.id, 1);
    expect(allowed.current).toBe(1);
    expect(allowed.allowed).toBe(true);
  });

  isolatedTest("counts members against the free limit", async () => {
    const workspace = await createWorkspace();
    await createMember(workspace.id);

    const blocked = await checkWorkspaceLimit(workspace.id, "members", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.current).toBe(1);
    expect(blocked.limit).toBe(3);
  });
});
