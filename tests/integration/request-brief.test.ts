import { afterAll, beforeAll, describe, expect } from "bun:test";

import { loadRequestBrief } from "@/features/feedback/brief-service";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";
import {
  createBoard,
  createFeedbackComment,
  createFeedbackPost,
  createProduct,
  createWorkspace,
} from "./factories";

/**
 * Brief loading.
 *
 * The builder is pure and covered by the unit suite; these tests prove the
 * loader resolves a request only inside its workspace (and product) and that an
 * internal note or an author email never reaches the Markdown.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("loadRequestBrief", () => {
  isolatedTest("renders public evidence but never an internal note or email", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { name: "Acme Cloud" });
    const board = await createBoard(product.id, { name: "Feedback", slug: "feedback" });
    const post = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Single sign-on",
      body: "Enterprise buyers need SAML.",
      status: "planned",
      authorEmail: "author@example.test",
    });

    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: post.id,
      authorType: "customer",
      authorName: "Ada",
      body: "SCIM too, please.",
    });
    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: post.id,
      internal: true,
      authorName: "Team",
      body: "Margin is thin.",
    });

    const brief = await loadRequestBrief({
      workspaceId: workspace.id,
      requestId: post.id,
    });

    expect(brief).not.toBeNull();
    if (!brief) return;

    expect(brief.markdown).toContain("# Single sign-on");
    expect(brief.markdown).toContain("> SCIM too, please.");
    expect(brief.markdown).toContain(`workspace \`${workspace.slug}\``);
    expect(brief.markdown).not.toContain("Margin is thin.");
    expect(brief.markdown).not.toContain("author@example.test");
  });

  isolatedTest("returns null for a request in another workspace", async () => {
    const owner = await createWorkspace();
    const other = await createWorkspace();
    const product = await createProduct(owner.id);
    const post = await createFeedbackPost({
      productId: product.id,
      title: "Tenant secret",
      body: "Only this workspace may read it.",
    });

    expect(
      await loadRequestBrief({ workspaceId: owner.id, requestId: post.id }),
    ).not.toBeNull();
    expect(
      await loadRequestBrief({ workspaceId: other.id, requestId: post.id }),
    ).toBeNull();
  });

  isolatedTest("refuses a request from another product in the same workspace", async () => {
    const workspace = await createWorkspace();
    const first = await createProduct(workspace.id);
    const second = await createProduct(workspace.id);
    const post = await createFeedbackPost({
      productId: first.id,
      title: "Scoped request",
      body: "Belongs to the first product.",
    });

    expect(
      await loadRequestBrief({
        workspaceId: workspace.id,
        productId: second.id,
        requestId: post.id,
      }),
    ).toBeNull();
    expect(
      await loadRequestBrief({
        workspaceId: workspace.id,
        productId: first.id,
        requestId: post.id,
      }),
    ).not.toBeNull();
  });
});
