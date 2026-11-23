import { afterAll, beforeAll, describe, expect } from "bun:test";

import {
  getPublicBoardPage,
  listPublicSitemapEntries,
} from "@/features/public/queries";
import { getPublicRoadmapPage } from "@/features/public/roadmap";
import { parsePublicBoardQuery } from "@/features/public/query";
import { resolvePublicBoard, resolvePublicProduct } from "@/features/public/resolver";
import { bulkUpdateFeedbackStatuses } from "@/features/feedback/triage";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createFeedbackVote,
  createModerationReview,
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
 * Public roadmap contract.
 *
 * The roadmap is a projection of feedback status, so this suite uses one
 * product and one status per visible column, then seeds every row that must
 * not appear: non-roadmap statuses, hidden, merged, archived, pending,
 * rejected, banned-author, private-board and archived-board requests. The
 * board and roadmap toggles are independent, and moving a request must change
 * the public column without a second write.
 */

beforeAll(async () => {
  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL = "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("public roadmap", () => {
  isolatedTest("publishes only visible planned, in-progress and shipped requests", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { publicRoadmapEnabled: true });
    const board = await createBoard(product.id, { name: "Feedback", slug: "feedback" });
    const moderated = await createBoard(product.id, {
      name: "Moderated",
      slug: "moderated",
      settings: {
        moderation: { requireApproval: "all", comments: "moderated", blockSensitiveInfo: false },
      },
    });
    const privateBoard = await createBoard(product.id, {
      name: "Private",
      slug: "private",
      visibility: "private",
    });
    const archivedBoard = await createBoard(product.id, {
      name: "Archived board",
      slug: "archived-board",
      archivedAt: new Date(),
    });
    const voter = await createUser();

    const planned = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Planned and public",
      status: "planned",
    });
    await createFeedbackVote({ feedbackPostId: planned.id, voterId: voter.id });
    await createFeedbackVote({ feedbackPostId: planned.id, voterId: (await createUser()).id });

    const inProgress = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "In progress",
      status: "in_progress",
    });
    const shipped = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Shipped",
      status: "shipped",
    });

    const approved = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: "Approved on a moderated board",
      status: "planned",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: approved.id,
      status: "approved",
    });

    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: "Pending on a moderated board",
      status: "planned",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: pending.id,
      status: "pending",
    });

    const rejected = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Rejected",
      status: "planned",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: rejected.id,
      status: "rejected",
    });

    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Hidden",
      status: "planned",
      hiddenAt: new Date(),
    });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Merged",
      status: "planned",
      mergedIntoId: planned.id,
    });
    const archived = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Archived",
      status: "planned",
      archivedAt: new Date(),
    });
    const bannedCustomer = await createCustomer(workspace.id, { bannedAt: new Date() });
    const banned = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Banned author",
      status: "planned",
      authorCustomerId: bannedCustomer.id,
    });
    const privateRequest = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: "Private board",
      status: "planned",
    });
    const archivedBoardRequest = await createFeedbackPost({
      productId: product.id,
      boardId: archivedBoard.id,
      title: "Archived board",
      status: "planned",
    });
    for (const status of ["open", "under_review", "closed"] as const) {
      await createFeedbackPost({
        productId: product.id,
        boardId: board.id,
        title: `Not on the roadmap: ${status}`,
        status,
      });
    }

    const page = await getPublicRoadmapPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(page).not.toBeNull();
    if (!page) return;

    expect(page.columns.map((column) => column.status)).toEqual([
      "planned",
      "in_progress",
      "shipped",
    ]);
    expect(page.columns[0]?.requests.map((request) => request.id).sort()).toEqual(
      [planned.id, approved.id].sort(),
    );
    expect(page.columns[1]?.requests.map((request) => request.id)).toEqual([inProgress.id]);
    expect(page.columns[2]?.requests.map((request) => request.id)).toEqual([shipped.id]);
    expect(page.columns[0]?.requests.find((request) => request.id === planned.id)?.voteCount).toBe(2);
    expect(page.firstBoard?.slug).toBe(board.slug);

    const excluded = [
      pending.id,
      rejected.id,
      hidden.id,
      merged.id,
      archived.id,
      banned.id,
      privateRequest.id,
      archivedBoardRequest.id,
    ];
    const allIds = page.columns.flatMap((column) => column.requests.map((request) => request.id));
    for (const id of excluded) expect(allIds).not.toContain(id);

    const entries = await listPublicSitemapEntries();
    expect(
      entries.some(
        (entry) =>
          entry.kind === "roadmap" &&
          entry.workspaceSlug === workspace.slug &&
          entry.productSlug === product.slug,
      ),
    ).toBe(true);
  });

  isolatedTest("feedback and roadmap visibility are independent", async () => {
    const workspace = await createWorkspace();
    const roadmapOnly = await createProduct(workspace.id, {
      publicRoadmapEnabled: true,
      publicFeedbackEnabled: false,
    });
    const board = await createBoard(roadmapOnly.id, { slug: "feedback" });
    const request = await createFeedbackPost({
      productId: roadmapOnly.id,
      boardId: board.id,
      title: "Roadmap without feedback",
      status: "planned",
    });

    const roadmap = await getPublicRoadmapPage({
      workspaceSlug: workspace.slug,
      productSlug: roadmapOnly.slug,
    });
    expect(roadmap?.columns[0]?.requests.map((card) => card.id)).toEqual([request.id]);
    expect(roadmap?.firstBoard).toBeNull();
    expect(
      await getPublicBoardPage(
        { workspaceSlug: workspace.slug, productSlug: roadmapOnly.slug, boardSlug: board.slug },
        parsePublicBoardQuery({}),
      ),
    ).toBeNull();
    expect(
      await resolvePublicBoard({
        workspaceSlug: workspace.slug,
        productSlug: roadmapOnly.slug,
        boardSlug: board.slug,
      }),
    ).toBeNull();
    expect(
      await resolvePublicProduct({
        workspaceSlug: workspace.slug,
        productSlug: roadmapOnly.slug,
      }),
    ).not.toBeNull();

    const feedbackOnly = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
      publicRoadmapEnabled: false,
    });
    const feedbackBoard = await createBoard(feedbackOnly.id, { slug: "feedback" });
    expect(
      await getPublicBoardPage(
        {
          workspaceSlug: workspace.slug,
          productSlug: feedbackOnly.slug,
          boardSlug: feedbackBoard.slug,
        },
        parsePublicBoardQuery({}),
      ),
    ).not.toBeNull();
    expect(
      await getPublicRoadmapPage({
        workspaceSlug: workspace.slug,
        productSlug: feedbackOnly.slug,
      }),
    ).toBeNull();

    const entries = await listPublicSitemapEntries();
    expect(
      entries.some(
        (entry) =>
          entry.kind === "roadmap" &&
          entry.workspaceSlug === workspace.slug &&
          entry.productSlug === roadmapOnly.slug,
      ),
    ).toBe(true);
    expect(
      entries.some(
        (entry) =>
          entry.kind === "board" &&
          entry.workspaceSlug === workspace.slug &&
          entry.productSlug === roadmapOnly.slug,
      ),
    ).toBe(false);
  });

  isolatedTest("a status move changes the public column without a second write", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { publicRoadmapEnabled: true });
    const board = await createBoard(product.id, { slug: "feedback" });
    const request = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Moves between columns",
      status: "planned",
    });

    const before = await getPublicRoadmapPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(before?.columns[0]?.requests.map((card) => card.id)).toEqual([request.id]);

    await bulkUpdateFeedbackStatuses({
      productId: product.id,
      postIds: [request.id],
      status: "in_progress",
    });

    const after = await getPublicRoadmapPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(after?.columns[0]?.requests).toEqual([]);
    expect(after?.columns[1]?.requests.map((card) => card.id)).toEqual([request.id]);
  });
});
