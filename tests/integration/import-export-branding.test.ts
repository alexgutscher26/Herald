import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boards, feedbackImportRows, feedbackPosts, jobs } from "@/db/schema";
import { getWorkspaceBranding, saveBrandingSettings } from "@/features/branding/branding";
import { checkBoardLimit } from "@/features/entitlements/entitlements";
import { buildExportBundle, buildRequestsCsv } from "@/features/export/service";
import { suggestMapping } from "@/features/import/adapters";
import { parseCsv } from "@/features/import/csv";
import {
  analyzeFeedbackImport,
  cancelFeedbackImport,
  createFeedbackImport,
  getFeedbackImport,
  listFeedbackImports,
  listImportPresets,
  processFeedbackImport,
  saveImportPreset,
} from "@/features/import/service";
import { downloadImportImage } from "@/features/import/attachments";
import { presetSignature } from "@/features/import/types";
import { resolvePublicBoard } from "@/features/public/resolver";
import {
  checkWorkspaceDomainHealth,
  getWorkspaceDomain,
  saveWorkspaceDomain,
  verifyWorkspaceDomain,
} from "@/features/workspace-settings/domains";

import {
  createBoard,
  createBoardTag,
  createFeedbackComment,
  createFeedbackPost,
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
 * Import, export, branding and the server-side plan gates.
 *
 * These exercise the real services against Postgres: the import runs through
 * its queued job, the export reads every related table, and the gates are
 * asserted at the data layer that the server actions call rather than through
 * the dashboard UI.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

const HEADERS = [
  "Title",
  "Details",
  "Board",
  "Status",
  "Category",
  "Author",
  "Email",
  "Votes",
  "Created at",
];

describe("CSV import", () => {
  isolatedTest("imports mapped rows, preserves votes and dates, reports bad rows", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const feedback = await createBoard(product.id, { name: "Feedback", slug: "feedback" });
    const ideas = await createBoard(product.id, { name: "Ideas", slug: "ideas" });
    const user = await createUser();

    const rows = [
      [
        "Dark mode",
        "Please add a dark theme",
        "Ideas",
        "Planned",
        "Bug",
        "Ada",
        "ada@example.test",
        "1,204",
        "2024-02-03",
      ],
      ["", "A row without a title", "Ideas", "Open", "Bug", "", "", "", ""],
      ["Wrong board", "Body", "Missing", "Open", "", "", "", "", ""],
      ["Fallback row", "Uses the target board", "", "Unknown", "", "", "", "0", ""],
    ];

    const created = await createFeedbackImport({
      workspaceId: workspace.id,
      productId: product.id,
      createdBy: user.id,
      fileName: "feedback.csv",
      format: "generic",
      boardId: feedback.id,
      headers: HEADERS,
      rows,
      mapping: suggestMapping(HEADERS, "generic"),
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.totalRows).toBe(4);

    const result = await processFeedbackImport(created.importId);
    expect(result.status).toBe("completed");
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.pending).toBe(0);

    const posts = await db
      .select()
      .from(feedbackPosts)
      .where(eq(feedbackPosts.importId, created.importId));

    expect(posts).toHaveLength(2);

    const dark = posts.find((post) => post.title === "Dark mode");
    expect(dark).toBeDefined();
    expect(dark?.boardId).toBe(ideas.id);
    expect(dark?.status).toBe("planned");
    expect(dark?.category).toBe("bug");
    expect(dark?.source).toBe("import");
    expect(dark?.importedVoteCount).toBe(1204);
    expect(dark?.authorEmail).toBe("ada@example.test");
    expect(dark?.authorCustomerId).not.toBeNull();
    expect(dark?.createdAt.toISOString().slice(0, 10)).toBe("2024-02-03");

    const fallback = posts.find((post) => post.title === "Fallback row");
    expect(fallback?.boardId).toBe(feedback.id);
    // An unrecognized status imports as Open rather than blocking the row.
    expect(fallback?.status).toBe("open");
    expect(fallback?.importedVoteCount).toBe(0);

    const detail = await getFeedbackImport(product.id, created.importId);
    expect(detail?.status).toBe("completed");
    expect(detail?.importedRows).toBe(2);
    expect(detail?.failedRows).toBe(2);
    expect(detail?.errors.map((error) => error.rowNumber).sort()).toEqual([2, 3]);

    const rowStates = await db
      .select({ rowNumber: feedbackImportRows.rowNumber, status: feedbackImportRows.status })
      .from(feedbackImportRows)
      .where(eq(feedbackImportRows.importId, created.importId));
    expect(rowStates).toHaveLength(4);
    expect(rowStates.filter((row) => row.status === "imported")).toHaveLength(2);

    // Running the same import again is a no-op; a retried job must not
    // duplicate rows.
    const again = await processFeedbackImport(created.importId);
    expect(again.status).toBe("completed");
    const count = await db
      .select()
      .from(feedbackPosts)
      .where(eq(feedbackPosts.importId, created.importId));
    expect(count).toHaveLength(2);
  });

  isolatedTest(
    "a 10,000-row import is stored, queued and then advanced without blocking the request",
    async () => {
      const workspace = await createWorkspace();
      const product = await createProduct(workspace.id);
      const board = await createBoard(product.id, { name: "Feedback", slug: "feedback" });
      const user = await createUser();

      const rows = Array.from({ length: 10_000 }, (_, index) => [
        `Request ${index + 1}`,
        "A row from a large export.",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);

      const created = await createFeedbackImport({
        workspaceId: workspace.id,
        productId: product.id,
        createdBy: user.id,
        fileName: "large-export.csv",
        format: "generic",
        boardId: board.id,
        headers: HEADERS,
        rows,
        mapping: { title: "Title", body: "Details" },
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.totalRows).toBe(10_000);

      // The upload copies rows and returns a queued job; no feedback post is
      // created inside the request.
      const queued = await getFeedbackImport(product.id, created.importId);
      expect(queued).toMatchObject({
        status: "queued",
        totalRows: 10_000,
        processedRows: 0,
        importedRows: 0,
      });
      expect(
        await db
          .select({ id: feedbackPosts.id })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.importId, created.importId)),
      ).toHaveLength(0);

      const startJob = await db
        .select({ type: jobs.type, payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.dedupeKey, `feedback-import:${created.importId}:start`));
      expect(startJob).toEqual([
        { type: "process_import", payload: { importId: created.importId } },
      ]);

      // A short budget forces the same continuation path the production job
      // uses when it reaches its time limit: one bounded batch, then a new job.
      const first = await processFeedbackImport(created.importId, { timeBudgetMs: 200 });
      expect(first.status).toBe("partial");
      expect(first.processed).toBeGreaterThan(0);
      expect(first.processed).toBeLessThan(10_000);
      expect(first.pending).toBe(10_000 - first.processed);

      const progress = await getFeedbackImport(product.id, created.importId);
      expect(progress).toMatchObject({
        status: "running",
        totalRows: 10_000,
        processedRows: first.processed,
        importedRows: first.imported,
        failedRows: first.failed,
      });

      const continuation = await db
        .select({ type: jobs.type, payload: jobs.payload })
        .from(jobs)
        .where(
          eq(jobs.dedupeKey, `feedback-import:${created.importId}:${first.processed}`),
        );
      expect(continuation).toEqual([
        { type: "process_import", payload: { importId: created.importId } },
      ]);

      // Progress and rows agree: the batch committed exactly what it reported.
      expect(
        await db
          .select({ id: feedbackPosts.id })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.importId, created.importId)),
      ).toHaveLength(first.imported);
    },
    60_000,
  );

  isolatedTest("import progress is scoped to the authorized product", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const other = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const user = await createUser();

    const created = await createFeedbackImport({
      workspaceId: workspace.id,
      productId: product.id,
      createdBy: user.id,
      fileName: "feedback.csv",
      format: "generic",
      boardId: board.id,
      headers: HEADERS,
      rows: [["A request", "", "", "", "", "", "", "", ""]],
      mapping: { title: "Title" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await getFeedbackImport(product.id, created.importId)).not.toBeNull();
    expect(await getFeedbackImport(other.id, created.importId)).toBeNull();
    expect(await listFeedbackImports(other.id)).toEqual([]);
  });

  isolatedTest("refuses a board that belongs to another product", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const other = await createProduct(workspace.id);
    const foreignBoard = await createBoard(other.id);
    const user = await createUser();

    const created = await createFeedbackImport({
      workspaceId: workspace.id,
      productId: product.id,
      createdBy: user.id,
      fileName: "feedback.csv",
      format: "generic",
      boardId: foreignBoard.id,
      headers: HEADERS,
      rows: [["A request", "", "", "", "", "", "", "", ""]],
      mapping: { title: "Title" },
    });

    expect(created).toEqual({ ok: false, error: "Choose a board in this product." });
  });
});

describe("import planning, cancel and presets", () => {
  isolatedTest("a dry run reports counts and writes nothing", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);

    const analysis = await analyzeFeedbackImport({
      productId: product.id,
      boardId: board.id,
      headers: HEADERS,
      rows: [
        ["Valid request", "", "", "planned", "bug", "", "", "5", "2024-01-02"],
        ["", "", "", "", "", "", "", "", ""],
        ["Another request", "", "", "mystery", "", "", "", "", ""],
      ],
      mapping: {
        title: "Title",
        status: "Status",
        category: "Category",
        votes: "Votes",
        createdAt: "Created at",
      },
    });

    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.plan.totalRows).toBe(3);
    expect(analysis.plan.importable).toBe(2);
    expect(analysis.plan.failed).toBe(1);
    expect(analysis.plan.skipped).toBe(0);
    expect(analysis.plan.warnings).toBe(1);
    expect(await listFeedbackImports(product.id)).toEqual([]);
  });

  isolatedTest("cancelling stops the worker before it imports pending rows", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const user = await createUser();

    const created = await createFeedbackImport({
      workspaceId: workspace.id,
      productId: product.id,
      createdBy: user.id,
      fileName: "rows.csv",
      format: "generic",
      boardId: board.id,
      headers: HEADERS,
      rows: [
        ["One", "", "", "", "", "", "", "", ""],
        ["Two", "", "", "", "", "", "", "", ""],
      ],
      mapping: { title: "Title" },
    });
    if (!created.ok) throw new Error(created.error);

    expect(await cancelFeedbackImport(product.id, created.importId)).toBe(true);
    expect(await cancelFeedbackImport(product.id, created.importId)).toBe(false);

    const result = await processFeedbackImport(created.importId);
    expect(result.status).toBe("cancelled");
    expect(result.imported).toBe(0);

    const detail = await getFeedbackImport(product.id, created.importId);
    expect(detail?.status).toBe("cancelled");
    expect(detail?.importedRows).toBe(0);
  });

  isolatedTest("a workspace mapping preset is replaced by its column signature", async () => {
    const workspace = await createWorkspace();
    const user = await createUser();

    const first = await saveImportPreset({
      workspaceId: workspace.id,
      createdBy: user.id,
      name: "Canny monthly",
      format: "canny",
      headers: HEADERS,
      mapping: { title: "Title", votes: "Votes" },
    });
    expect(first.ok).toBe(true);

    const second = await saveImportPreset({
      workspaceId: workspace.id,
      createdBy: user.id,
      name: "Canny renamed",
      format: "canny",
      headers: HEADERS,
      mapping: { title: "Title", votes: "Votes" },
    });
    expect(second.ok).toBe(true);

    const presets = await listImportPresets(workspace.id);
    expect(presets).toHaveLength(1);
    expect(presets[0]?.name).toBe("Canny renamed");
    expect(presets[0]?.signature).toBe(presetSignature(HEADERS));
  });

  isolatedTest("remote images refuse loopback and private addresses", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    for (const url of ["http://127.0.0.1/a.png", "http://169.254.169.254/latest/meta-data"]) {
      await expect(
        downloadImportImage({ workspaceId: workspace.id, productId: product.id, url }),
      ).rejects.toThrow();
    }
  });
});

describe("export", () => {
  isolatedTest("includes merge provenance, comments and tags, and marks duplicates", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { name: "Feedback" });

    const canonical = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Canonical request",
    });
    const duplicate = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Duplicate request",
      mergedIntoId: canonical.id,
    });

    await createBoardTag(board.id, product.id, { name: "Enterprise" });
    await linkTagToPost({
      productId: product.id,
      feedbackPostId: canonical.id,
      tagName: "Enterprise",
    });
    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: canonical.id,
      body: "An internal note",
      internal: true,
    });

    const bundle = await buildExportBundle({
      workspaceId: workspace.id,
      productId: product.id,
    });

    expect(bundle).not.toBeNull();
    if (!bundle) return;

    expect(bundle.requests).toHaveLength(2);

    const exportedCanonical = bundle.requests.find((request) => request.id === canonical.id);
    expect(exportedCanonical?.tags).toEqual(["Enterprise"]);
    expect(exportedCanonical?.comments[0]?.internal).toBe(true);

    const exportedDuplicate = bundle.requests.find((request) => request.id === duplicate.id);
    expect(exportedDuplicate?.mergedInto).toEqual({
      id: canonical.id,
      title: "Canonical request",
      status: "open",
    });

    const csv = parseCsv(buildRequestsCsv(bundle));
    const idIndex = csv.headers.indexOf("id");
    const mergedIndex = csv.headers.indexOf("merged_into_id");
    const titleIndex = csv.headers.indexOf("merged_into_title");
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(mergedIndex).toBeGreaterThanOrEqual(0);

    const duplicateRow = csv.rows.find((row) => row[idIndex] === duplicate.id);
    expect(duplicateRow?.[mergedIndex]).toBe(canonical.id);
    expect(duplicateRow?.[titleIndex]).toBe("Canonical request");

    const canonicalRow = csv.rows.find((row) => row[idIndex] === canonical.id);
    expect(canonicalRow?.[mergedIndex]).toBe("");
  });

  isolatedTest("never exports a product through a foreign workspace id", async () => {
    const workspace = await createWorkspace();
    const other = await createWorkspace();
    const product = await createProduct(workspace.id);

    expect(
      await buildExportBundle({ workspaceId: other.id, productId: product.id }),
    ).toBeNull();
  });
});

describe("branding", () => {
  isolatedTest("defaults, validates, upserts and preserves an existing logo", async () => {
    const workspace = await createWorkspace();

    expect(await getWorkspaceBranding(workspace.id)).toMatchObject({
      brandName: "",
      primaryColor: "",
      theme: "light",
      locale: "auto",
      hasLogo: false,
      updatedAt: null,
    });

    const invalid = await saveBrandingSettings({
      workspaceId: workspace.id,
      brandName: "Kudo",
      primaryColor: "rebeccapurple",
      theme: "light",
      locale: "auto",
    });
    expect(invalid.ok).toBe(false);

    const saved = await saveBrandingSettings({
      workspaceId: workspace.id,
      brandName: "  Kudo  ",
      primaryColor: "#4F46E5",
      theme: "dark",
      locale: "es",
      logoKey: "workspaces/kudo/logo.png",
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.branding).toMatchObject({
      brandName: "Kudo",
      primaryColor: "#4f46e5",
      theme: "dark",
      locale: "es",
      hasLogo: true,
      logoKey: "workspaces/kudo/logo.png",
    });

    // Omitting logoKey means "keep the current logo"; the upsert must not clear it.
    const second = await saveBrandingSettings({
      workspaceId: workspace.id,
      brandName: "Kudo Two",
      primaryColor: "#4f46e5",
      theme: "auto",
      locale: "auto",
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.branding).toMatchObject({
      brandName: "Kudo Two",
      theme: "auto",
      locale: "auto",
      hasLogo: true,
      logoKey: "workspaces/kudo/logo.png",
    });
  });
});

describe("custom domains", () => {
  isolatedTest("verification and HTTPS health are stored and visible", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);

    const saved = await saveWorkspaceDomain({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      productId: product.id,
      domain: "Feedback.Example.com",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.domain).toMatchObject({
      domain: "feedback.example.com",
      status: "pending",
      healthStatus: "unknown",
      txtRecordName: "_herald.feedback.example.com",
    });

    let lookupHost = "";
    const verified = await verifyWorkspaceDomain({
      workspaceId: workspace.id,
      lookupTxt: async (hostname) => {
        lookupHost = hostname;
        return [[saved.domain.verificationToken]];
      },
    });
    expect(lookupHost).toBe("_herald.feedback.example.com");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.domain.status).toBe("verified");

    let healthUrl = "";
    const healthy = await checkWorkspaceDomainHealth({
      workspaceId: workspace.id,
      fetchImpl: (async (input: RequestInfo | URL) => {
        healthUrl = String(input);
        return new Response(JSON.stringify({ status: "ok", scope: "readiness" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    expect(healthUrl).toBe("https://feedback.example.com/api/health?scope=readiness");
    expect(healthy.ok).toBe(true);
    if (!healthy.ok) return;
    expect(healthy.domain.healthStatus).toBe("healthy");
    expect(healthy.domain.healthMessage).toContain("HTTPS");
    expect(healthy.domain.lastCheckedAt).not.toBeNull();

    expect(await getWorkspaceDomain(workspace.id)).toMatchObject({
      status: "verified",
      healthStatus: "healthy",
    });
  });
});

describe("server-side plan gates", () => {
  isolatedTest("the free board limit counts active boards only", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const product = await createProduct(workspace.id);

    const first = await createBoard(product.id);
    await createBoard(product.id);

    const blocked = await checkBoardLimit(product.id, 1);
    expect(blocked).toMatchObject({ plan: "free", limit: 2, allowed: false });

    await db
      .update(boards)
      .set({ archivedAt: new Date() })
      .where(eq(boards.id, first.id));

    const allowed = await checkBoardLimit(product.id, 1);
    expect(allowed.allowed).toBe(true);

    // Replacing the archived board uses the freed slot; the next board does not fit.
    await createBoard(product.id);
    expect((await checkBoardLimit(product.id, 1)).allowed).toBe(false);
  });

  isolatedTest("a downgraded workspace loses guest posting on public resolution", async () => {
    const free = await createWorkspace({ plan: "free" });
    const freeProduct = await createProduct(free.id);
    const freeBoard = await createBoard(freeProduct.id, {
      slug: "feedback",
      guestPosting: true,
    });

    const resolvedFree = await resolvePublicBoard({
      workspaceSlug: free.slug,
      productSlug: freeProduct.slug,
      boardSlug: freeBoard.slug,
    });
    expect(resolvedFree?.board.guestPosting).toBe(false);

    const pro = await createWorkspace({ plan: "pro" });
    const proProduct = await createProduct(pro.id);
    const proBoard = await createBoard(proProduct.id, {
      slug: "feedback",
      guestPosting: true,
    });

    const resolvedPro = await resolvePublicBoard({
      workspaceSlug: pro.slug,
      productSlug: proProduct.slug,
      boardSlug: proBoard.slug,
    });
    expect(resolvedPro?.board.guestPosting).toBe(true);

    const proLimit = await checkBoardLimit(proProduct.id, 1);
    expect(proLimit).toMatchObject({ plan: "pro", limit: null, allowed: true });
  });
});
