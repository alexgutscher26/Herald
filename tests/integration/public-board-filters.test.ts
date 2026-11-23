import { afterAll, beforeAll, describe, expect } from "bun:test";

import { parsePublicBoardQuery, type RawPublicBoardQuery } from "@/features/public/query";
import { getPublicBoardPage } from "@/features/public/queries";

import {
  createBoard,
  createBoardTag,
  createFeedbackPost,
  createFeedbackVote,
  createProduct,
  createUser,
  createWorkspace,
  linkTagToPost,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The board's filters are SQL, not post-processing. These tests prove that
 * search is literal (a `%` is a character, not a wildcard), that each filter
 * narrows the rows, that sorting is stable, and that pagination reports the
 * true total rather than the size of a page after in-memory filtering.
 */

let previousFlag: string | undefined;

beforeAll(async () => {
  previousFlag = process.env.FLAG_PUBLIC_FEEDBACK;
  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousFlag === undefined) delete process.env.FLAG_PUBLIC_FEEDBACK;
  else process.env.FLAG_PUBLIC_FEEDBACK = previousFlag;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

type Tenant = Awaited<ReturnType<typeof createWorkspace>> & {
  product: Awaited<ReturnType<typeof createProduct>>;
  board: Awaited<ReturnType<typeof createBoard>>;
};

async function tenant(options?: { slug?: string; plan?: "free" | "pro" }): Promise<Tenant> {
  const workspace = await createWorkspace({ plan: options?.plan });
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: options?.slug ?? "feedback",
    name: "Feedback",
    position: 2,
  });
  return Object.assign(workspace, { product, board });
}

function readPage(
  site: Tenant,
  raw: RawPublicBoardQuery = {},
  boardSlug = site.board.slug,
) {
  return getPublicBoardPage(
    {
      workspaceSlug: site.slug,
      productSlug: site.product.slug,
      boardSlug,
    },
    parsePublicBoardQuery(raw),
  );
}

describe("public board search", () => {
  isolatedTest("matches title and body case-insensitively", async () => {
    const site = await tenant({ plan: "pro" });
    const dark = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Dark mode please",
      body: "Add a light theme toggle.",
    });
    const exported = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Export CSV",
      body: "Download your data.",
    });

    expect((await readPage(site, { q: "dark" }))?.requests.map((r) => r.id)).toEqual([
      dark.id,
    ]);
    expect((await readPage(site, { q: "LIGHT THEME" }))?.requests.map((r) => r.id)).toEqual([
      dark.id,
    ]);
    expect((await readPage(site, { q: "csv" }))?.requests.map((r) => r.id)).toEqual([
      exported.id,
    ]);
    expect((await readPage(site, { q: "nothing-matches" }))?.requests).toEqual([]);
  });

  isolatedTest("treats a percent sign as a character, not a wildcard", async () => {
    const site = await tenant();
    await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Plain request",
    });
    const percent = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "100% coverage",
    });

    const page = await readPage(site, { q: "100%" });
    expect(page?.requests.map((r) => r.id)).toEqual([percent.id]);
    // If the pattern were unescaped, `%` alone would match every row.
    expect((await readPage(site, { q: "%" }))?.requests.map((r) => r.id)).toEqual([
      percent.id,
    ]);
  });
});

describe("public board filters", () => {
  isolatedTest("filters by status, tag and both together", async () => {
    const site = await tenant();
    const planned = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Planned request",
      status: "planned",
    });
    const open = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Open request",
      status: "open",
    });

    await createBoardTag(site.board.id, site.product.id, {
      name: "billing",
      position: 0,
    });
    await createBoardTag(site.board.id, site.product.id, {
      name: "ux",
      position: 1,
    });
    await linkTagToPost({
      productId: site.product.id,
      feedbackPostId: open.id,
      tagName: "billing",
    });
    await linkTagToPost({
      productId: site.product.id,
      feedbackPostId: planned.id,
      tagName: "ux",
    });

    expect((await readPage(site, { status: "planned" }))?.requests.map((r) => r.id)).toEqual([
      planned.id,
    ]);
    expect((await readPage(site, { tag: "billing" }))?.requests.map((r) => r.id)).toEqual([
      open.id,
    ]);
    expect(
      (await readPage(site, { status: "open", tag: "billing" }))?.requests.map((r) => r.id),
    ).toEqual([open.id]);
    expect((await readPage(site, { status: "open", tag: "ux" }))?.requests).toEqual([]);
  });

  isolatedTest("does not accept a tag from another board", async () => {
    const site = await tenant();
    const otherBoard = await createBoard(site.product.id, { slug: "other" });
    await createBoardTag(otherBoard.id, site.product.id, { name: "private-tag" });
    await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Belongs here",
    });

    expect((await readPage(site, { tag: "private-tag" }))?.requests).toEqual([]);
  });
});

describe("public board sorting", () => {
  isolatedTest("Top ranks by all-time votes and Newest by creation time", async () => {
    const site = await tenant();
    const older = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Popular older request",
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
    const newer = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Quiet newer request",
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });

    const voters = await Promise.all([createUser(), createUser(), createUser()]);
    for (const voter of voters) {
      await createFeedbackVote({ feedbackPostId: older.id, voterId: voter.id });
    }

    expect((await readPage(site, { sort: "top" }))?.requests.map((r) => r.id)).toEqual([
      older.id,
      newer.id,
    ]);
    expect((await readPage(site, { sort: "newest" }))?.requests.map((r) => r.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  isolatedTest("Trending counts only recent engagement", async () => {
    const site = await tenant();
    const oldButLoved = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Popular last month",
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const fresh = await createFeedbackPost({
      productId: site.product.id,
      boardId: site.board.id,
      title: "Moving now",
    });

    const voters = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);
    const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const voter of voters.slice(0, 3)) {
      await createFeedbackVote({
        feedbackPostId: oldButLoved.id,
        voterId: voter.id,
        createdAt: lastMonth,
      });
    }
    await createFeedbackVote({
      feedbackPostId: fresh.id,
      voterId: voters[3]!.id,
    });

    expect((await readPage(site, { sort: "top" }))?.requests.map((r) => r.id)).toEqual([
      oldButLoved.id,
      fresh.id,
    ]);
    expect(
      (await readPage(site, { sort: "trending" }))?.requests.map((r) => r.id),
    ).toEqual([fresh.id, oldButLoved.id]);
  });
});

describe("public board pagination", () => {
  isolatedTest("reports the full total and clamps an out-of-range page", async () => {
    const site = await tenant();
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const post = await createFeedbackPost({
        productId: site.product.id,
        boardId: site.board.id,
        title: `Request ${index}`,
        createdAt: new Date(Date.now() - index * 60 * 60 * 1000),
      });
      ids.push(post.id);
    }

    const first = await readPage(site, { pageSize: "2" });
    expect(first?.requests.map((r) => r.id)).toEqual([ids[0]!, ids[1]!]);
    expect(first?.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const third = await readPage(site, { page: "3", pageSize: "2" });
    expect(third?.requests.map((r) => r.id)).toEqual([ids[4]!]);

    const beyond = await readPage(site, { page: "99", pageSize: "2" });
    expect(beyond?.pagination.page).toBe(3);
    expect(beyond?.requests.map((r) => r.id)).toEqual([ids[4]!]);
  });

  isolatedTest("filters before paginating", async () => {
    const site = await tenant();
    for (let index = 0; index < 4; index += 1) {
      await createFeedbackPost({
        productId: site.product.id,
        boardId: site.board.id,
        title: `Open ${index}`,
        status: "open",
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await createFeedbackPost({
        productId: site.product.id,
        boardId: site.board.id,
        title: `Planned ${index}`,
        status: "planned",
      });
    }

    const page = await readPage(site, { status: "planned", pageSize: "2" });
    expect(page?.pagination.total).toBe(3);
    expect(page?.pagination.totalPages).toBe(2);
    expect(page?.requests).toHaveLength(2);
    expect(page?.requests.every((request) => request.status === "planned")).toBe(true);
  });
});

describe("public board facets", () => {
  isolatedTest("lists only public boards of this product and tags of this board", async () => {
    const site = await tenant();
    await createBoard(site.product.id, {
      name: "Ideas",
      slug: "ideas",
      position: 0,
    });
    await createBoard(site.product.id, {
      name: "Private",
      slug: "private",
      visibility: "private",
      position: -1,
    });
    await createBoard(site.product.id, {
      name: "Retired",
      slug: "retired",
      archivedAt: new Date(),
      position: -2,
    });

    const otherProduct = await createProduct(site.id);
    await createBoard(otherProduct.id, { name: "Elsewhere", slug: "elsewhere" });

    await createBoardTag(site.board.id, site.product.id, {
      name: "ux",
      color: "#123456",
      position: 1,
    });
    await createBoardTag(site.board.id, site.product.id, {
      name: "billing",
      color: "#654321",
      position: 0,
    });

    const page = await readPage(site);
    expect(page?.boards.map((board) => board.slug)).toEqual(["ideas", "feedback"]);
    expect(page?.tags.map((tag) => tag.name)).toEqual(["billing", "ux"]);
    expect(page?.tags[0]?.color).toBe("#654321");
  });
});
