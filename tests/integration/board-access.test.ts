import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { customerCompanies, customerCompanyMemberships, customers } from "@/db/schema";
import { replaceBoardAccessRules } from "@/features/public/access";
import { resolvePublicBoard } from "@/features/public/resolver";

import {
  createBoard,
  createCustomer,
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
 * Segment gating against real Postgres.
 *
 * The resolver is the only place that decides, so these tests call it exactly
 * the way the pages and write routes do — and expect the same 404 a visitor
 * gets for a board that does not exist, never a 403 that confirms one does.
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
  const board = await createBoard(product.id, { slug: "roadmap", name: "Roadmap" });
  return {
    workspace,
    product,
    board,
    path: {
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    },
  };
}

describe("board segment access", () => {
  isolatedTest("an open board resolves for everyone and needs no viewer", async () => {
    const t = await tenant();
    const anonymous = await resolvePublicBoard(t.path);
    expect(anonymous?.board.id).toBe(t.board.id);

    const visitor = await createCustomer(t.workspace.id, { email: "ada@example.com" });
    const known = await resolvePublicBoard({ ...t.path, viewerCustomerId: visitor.id });
    expect(known?.board.id).toBe(t.board.id);
  });

  isolatedTest("an email-domain rule denies anonymous visitors and other domains", async () => {
    const t = await tenant();
    const insider = await createCustomer(t.workspace.id, { email: "ada@acme.com" });
    const outsider = await createCustomer(t.workspace.id, { email: "bob@other.com" });

    const written = await replaceBoardAccessRules({
      productId: t.product.id,
      boardId: t.board.id,
      rules: [{ match: "email_domain", value: "Acme.com" }],
    });
    expect(written.ok).toBe(true);

    expect(await resolvePublicBoard(t.path)).toBeNull();
    expect(
      await resolvePublicBoard({ ...t.path, viewerCustomerId: insider.id }),
    ).not.toBeNull();
    expect(
      await resolvePublicBoard({ ...t.path, viewerCustomerId: outsider.id }),
    ).toBeNull();
  });

  isolatedTest("a company rule matches membership, not an emailed domain", async () => {
    const t = await tenant();
    const insider = await createCustomer(t.workspace.id, { email: "ada@random.test" });
    const outsider = await createCustomer(t.workspace.id, { email: "bob@acme.com" });

    const companies = await db
      .insert(customerCompanies)
      .values({ workspaceId: t.workspace.id, name: "Acme", domain: "acme.com" })
      .returning({ id: customerCompanies.id });
    const companyId = companies[0]?.id;
    if (!companyId) throw new Error("Company insert returned no row.");

    await db.insert(customerCompanyMemberships).values({
      workspaceId: t.workspace.id,
      customerId: insider.id,
      companyId,
    });

    const written = await replaceBoardAccessRules({
      productId: t.product.id,
      boardId: t.board.id,
      rules: [{ match: "company", value: companyId }],
    });
    expect(written.ok).toBe(true);

    expect(
      await resolvePublicBoard({ ...t.path, viewerCustomerId: insider.id }),
    ).not.toBeNull();
    expect(
      await resolvePublicBoard({ ...t.path, viewerCustomerId: outsider.id }),
    ).toBeNull();
  });

  isolatedTest("a trait rule matches the customer and their company", async () => {
    const t = await tenant();
    const customer = await createCustomer(t.workspace.id, { email: "ada@acme.com" });
    // Traits are jsonb; the factory does not take them, so the test sets the
    // exact shape the resolver reads.
    await db
      .update(customers)
      .set({ traits: { plan: "enterprise" } })
      .where(eq(customers.id, customer.id));

    const written = await replaceBoardAccessRules({
      productId: t.product.id,
      boardId: t.board.id,
      rules: [{ match: "trait", traitKey: "plan", value: "enterprise" }],
    });
    expect(written.ok).toBe(true);

    expect(
      await resolvePublicBoard({ ...t.path, viewerCustomerId: customer.id }),
    ).not.toBeNull();
    expect(await resolvePublicBoard(t.path)).toBeNull();
  });

  isolatedTest("clearing the rules reopens the board", async () => {
    const t = await tenant();
    await replaceBoardAccessRules({
      productId: t.product.id,
      boardId: t.board.id,
      rules: [{ match: "email_domain", value: "acme.com" }],
    });
    expect(await resolvePublicBoard(t.path)).toBeNull();

    const cleared = await replaceBoardAccessRules({
      productId: t.product.id,
      boardId: t.board.id,
      rules: [],
    });
    expect(cleared.ok).toBe(true);
    expect(await resolvePublicBoard(t.path)).not.toBeNull();
  });

  isolatedTest("gating does not make a private board public, and rules stay in their product", async () => {
    const t = await tenant();
    const privateBoard = await createBoard(t.product.id, {
      slug: "private-roadmap",
      name: "Private roadmap",
      visibility: "private",
    });
    const insider = await createCustomer(t.workspace.id, { email: "ada@acme.com" });
    await replaceBoardAccessRules({
      productId: t.product.id,
      boardId: privateBoard.id,
      rules: [{ match: "email_domain", value: "acme.com" }],
    });

    expect(
      await resolvePublicBoard({
        ...t.path,
        boardSlug: privateBoard.slug,
        viewerCustomerId: insider.id,
      }),
    ).toBeNull();

    const other = await tenant();
    const foreign = await replaceBoardAccessRules({
      productId: other.product.id,
      boardId: t.board.id,
      rules: [{ match: "email_domain", value: "acme.com" }],
    });
    expect(foreign.ok).toBe(false);
  });
});
