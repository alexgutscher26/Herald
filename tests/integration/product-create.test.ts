import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { boards, products } from "@/db/schema";
import { createProductForWorkspace } from "@/features/products/service";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";
import { createProduct, createWorkspace, uniqueLabel } from "./factories";

/**
 * Creating a product from workspace settings.
 *
 * These tests call the service the server action delegates to, so they exercise
 * the same allowance gate and transaction without a request session. Permission
 * checks live in `createProductAction` and are covered by the permissions unit
 * suite.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function productCount(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.workspaceId, workspaceId));
  return rows[0]?.value ?? 0;
}

describe("createProductForWorkspace", () => {
  isolatedTest("creates the product and its default feedback board", async () => {
    const workspace = await createWorkspace();
    const slug = uniqueLabel("mobile");

    const created = await createProductForWorkspace({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      name: "Mobile app",
      slug,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.product.slug).toBe(slug);
    expect(created.product.name).toBe("Mobile app");

    const boardRows = await db
      .select({ name: boards.name, slug: boards.slug, position: boards.position })
      .from(boards)
      .where(eq(boards.productId, created.product.id));

    expect(boardRows).toEqual([{ name: "Feedback", slug: "feedback", position: 0 }]);
    expect(await productCount(workspace.id)).toBe(1);
  });

  isolatedTest("refuses a product beyond the Free allowance", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    await createProduct(workspace.id);

    const refused = await createProductForWorkspace({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      name: "Second product",
      slug: uniqueLabel("second"),
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toContain("Free plan allows 1 product");
    expect(await productCount(workspace.id)).toBe(1);
  });

  isolatedTest("allows another product on Professional", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    await createProduct(workspace.id);

    const created = await createProductForWorkspace({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      name: "Second product",
      slug: uniqueLabel("second"),
    });

    expect(created.ok).toBe(true);
    expect(await productCount(workspace.id)).toBe(2);
  });

  isolatedTest("reports a duplicate slug as a field error and writes nothing", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const existing = await createProduct(workspace.id, { slug: "billing" });

    const refused = await createProductForWorkspace({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      name: "Billing again",
      slug: "billing",
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.fieldErrors?.slug?.[0]).toContain("already used");
    expect(await productCount(workspace.id)).toBe(1);

    const boardRows = await db
      .select({ value: count() })
      .from(boards)
      .where(eq(boards.productId, existing.id));
    expect(boardRows[0]?.value ?? 0).toBe(0);
  });

  isolatedTest("scopes slugs to the workspace, not the whole installation", async () => {
    const first = await createWorkspace({ plan: "pro" });
    const second = await createWorkspace({ plan: "pro" });
    await createProduct(first.id, { slug: "roadmap" });

    const created = await createProductForWorkspace({
      workspaceId: second.id,
      workspaceSlug: second.slug,
      name: "Roadmap",
      slug: "roadmap",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rows = await db
      .select({ workspaceId: products.workspaceId })
      .from(products)
      .where(and(eq(products.slug, "roadmap"), eq(products.id, created.product.id)));
    expect(rows[0]?.workspaceId).toBe(second.id);
  });
});
