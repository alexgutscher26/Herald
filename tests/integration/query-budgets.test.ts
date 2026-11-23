import { afterAll, beforeAll, describe, expect } from "bun:test";

import { startQueryCount, stopQueryCount } from "@/db/query-count";
import { listConversations } from "@/features/conversations/queries";
import { loadDashboardSnapshot } from "@/features/live/snapshot";
import { permissionsFor } from "@/lib/permissions";
import type { ProductContext } from "@/lib/authz";
import type { User } from "@/db/schema/auth";
import type { Product, Workspace } from "@/db/schema/workspaces";

import {
  createBoard,
  createConversation,
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createUser,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * N+1 detector for the two list paths that grow with a product's data.
 *
 * A wall-clock assertion would be flaky on CI. Instead these compare the number
 * of SQL statements at two row counts: if a per-row query appears, the larger
 * fixture issues more statements and the test fails. The absolute ceilings also
 * catch a regression that adds a constant number of round trips.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

const SNAPSHOT_STATEMENT_BUDGET = 30;
const INBOX_STATEMENT_BUDGET = 12;

function productContext(
  workspace: Workspace,
  product: Product,
  user: User,
): ProductContext {
  return {
    user: { id: user.id, name: user.name, email: user.email },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      publicPlannedFor: workspace.publicPlannedFor,
      doubleOptIn: workspace.doubleOptIn,
      outboundFrequencyCap: workspace.outboundFrequencyCap,
      outboundFrequencyWindowDays: workspace.outboundFrequencyWindowDays,
      createdBy: workspace.createdBy,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    role: "owner",
    permissions: permissionsFor("owner"),
    customRoleId: null,
    customRoleName: null,
    product: {
      id: product.id,
      workspaceId: product.workspaceId,
      name: product.name,
      slug: product.slug,
      description: product.description,
      publicFeedbackEnabled: product.publicFeedbackEnabled,
      publicRoadmapEnabled: product.publicRoadmapEnabled,
      publicChangelogEnabled: product.publicChangelogEnabled,
      publicShippedCounterEnabled: product.publicShippedCounterEnabled,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    },
  };
}

describe("query budgets", () => {
  isolatedTest("the dashboard snapshot statement count does not grow with requests", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const context = productContext(workspace, product, user);

    const measure = async (): Promise<number> => {
      startQueryCount();
      await loadDashboardSnapshot(context);
      return stopQueryCount().length;
    };

    for (let index = 0; index < 3; index += 1) {
      await createFeedbackPost({ productId: product.id, boardId: board.id });
    }
    const small = await measure();

    for (let index = 0; index < 40; index += 1) {
      await createFeedbackPost({ productId: product.id, boardId: board.id });
    }
    const large = await measure();

    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(SNAPSHOT_STATEMENT_BUDGET);
  });

  isolatedTest("the inbox list statement count does not grow with conversations", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const customer = await createCustomer(workspace.id);
    const user = await createUser();

    const measure = async (): Promise<number> => {
      startQueryCount();
      await listConversations({
        productId: product.id,
        userId: user.id,
        filters: { view: "queue", query: "", assignee: "any" },
        limit: 50,
      });
      return stopQueryCount().length;
    };

    for (let index = 0; index < 3; index += 1) {
      await createConversation({
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
      });
    }
    const small = await measure();

    for (let index = 0; index < 40; index += 1) {
      await createConversation({
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
      });
    }
    const large = await measure();

    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(INBOX_STATEMENT_BUDGET);
  });
});
