import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import {
  apiTokens,
  conversationMessages,
  conversations,
  customFields,
  feedbackComments,
  feedbackCustomFieldValues,
  feedbackPosts,
  releases,
  type ApiScope,
} from "@/db/schema";
import { handleApiRequest } from "@/features/api-v1/router";
import { createApiTokenMaterial } from "@/features/api-v1/token";

import {
  createBoard,
  createBoardTag,
  createConversation,
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createRelease,
  createWorkspace,
  linkTagToPost,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * End-to-end coverage for `/api/v1` against real Postgres.
 *
 * Calls go through the router, so bearer authentication, scopes, rate-limit
 * bookkeeping, idempotency and error translation are all exercised. Each test
 * rolls its transaction back.
 */

const previousFlag = process.env.FLAG_API;

beforeAll(async () => {
  process.env.FLAG_API = "on";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
  if (previousFlag === undefined) delete process.env.FLAG_API;
  else process.env.FLAG_API = previousFlag;
}, SETUP_TIMEOUT_MS);

type ApiResponse = {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
};

function segmentsFor(path: string): string[] {
  const url = new URL(`http://localhost/api/v1${path}`);
  return url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
}

async function call(
  token: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<ApiResponse> {
  const url = new URL(`http://localhost/api/v1${path}`);
  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  if (body !== undefined) headers.set("content-type", "application/json");

  const request = new NextRequest(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const response = await handleApiRequest(request, {
    params: Promise.resolve({ segments: segmentsFor(path) }),
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

async function mintToken(
  workspaceId: string,
  createdBy: string | null,
  scopes: ApiScope[] = ["read", "write"],
): Promise<string> {
  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId,
      name: "Integration token",
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes,
      createdBy,
    })
    .returning({ id: apiTokens.id });

  if (!rows[0]) throw new Error("Token insert returned no row.");
  return material.token;
}

function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (typeof data !== "object" || data === null) throw new Error("Response has no data.");
  return data as Record<string, unknown>;
}

describe("REST API v1", () => {
  isolatedTest("keeps every read inside the token's workspace", async () => {
    const workspaceA = await createWorkspace({ plan: "pro" });
    const productA = await createProduct(workspaceA.id);
    const boardA = await createBoard(productA.id);
    const { user } = await createMember(workspaceA.id, { role: "owner" });
    const tokenA = await mintToken(workspaceA.id, user.id);

    const workspaceB = await createWorkspace({ plan: "pro" });
    const productB = await createProduct(workspaceB.id);
    const boardB = await createBoard(productB.id);
    const requestB = await createFeedbackPost({
      productId: productB.id,
      boardId: boardB.id,
      title: "Workspace B private request",
    });

    const requestA = await createFeedbackPost({
      productId: productA.id,
      boardId: boardA.id,
      title: "Workspace A request",
    });

    const list = await call(tokenA, "GET", "/requests");
    expect(list.status).toBe(200);
    const rows = list.body.data as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual([requestA.id]);

    const crossTenant = await call(tokenA, "GET", `/requests/${requestB.id}`);
    expect(crossTenant.status).toBe(404);
    expect((crossTenant.body.error as { code: string }).code).toBe("not_found");

    const boards = await call(tokenA, "GET", "/boards");
    expect(boards.status).toBe(200);
    const boardIds = (boards.body.data as { id: string }[]).map((row) => row.id);
    expect(boardIds).toEqual([boardA.id]);
  });

  isolatedTest("filters, sorts and pages with an opaque cursor", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const now = Date.now();
    const first = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Oldest open request",
      status: "open",
      createdAt: new Date(now - 3000),
    });
    const second = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Planned request",
      status: "planned",
      createdAt: new Date(now - 2000),
    });
    const third = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Newest open request",
      status: "open",
      createdAt: new Date(now - 1000),
    });

    const customer = await createCustomer(workspace.id, {
      email: "author@example.test",
      name: "Filtered Author",
    });
    await db
      .update(feedbackPosts)
      .set({ authorCustomerId: customer.id, authorEmail: customer.email })
      .where(eq(feedbackPosts.id, third.id));

    await createBoardTag(board.id, product.id, { name: "api" });
    await linkTagToPost({ productId: product.id, feedbackPostId: second.id, tagName: "api" });

    const planned = await call(token, "GET", "/requests?status=planned");
    expect(planned.status).toBe(200);
    expect((planned.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      second.id,
    ]);

    const tagged = await call(token, "GET", "/requests?tag=api");
    expect((tagged.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      second.id,
    ]);

    const authored = await call(token, "GET", "/requests?author=author@example.test");
    expect((authored.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      third.id,
    ]);

    const future = new Date(now + 60_000).toISOString();
    const none = await call(token, "GET", `/requests?updated_since=${future}`);
    expect(none.body.data).toEqual([]);

    const pageOne = await call(token, "GET", "/requests?limit=2&sort=newest");
    expect(pageOne.status).toBe(200);
    const pagination = pageOne.body.pagination as {
      has_more: boolean;
      next_cursor: string | null;
    };
    expect((pageOne.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      third.id,
      second.id,
    ]);
    expect(pagination.has_more).toBe(true);
    expect(pagination.next_cursor).toBeTruthy();

    const pageTwo = await call(
      token,
      "GET",
      `/requests?limit=2&sort=newest&cursor=${encodeURIComponent(pagination.next_cursor ?? "")}`,
    );
    expect((pageTwo.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      first.id,
    ]);
    expect((pageTwo.body.pagination as { has_more: boolean }).has_more).toBe(false);

    const badCursor = await call(token, "GET", "/requests?cursor=nope");
    expect(badCursor.status).toBe(400);
  });

  isolatedTest("sorts requests by a numeric custom field with a cursor", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const seats = await db
      .insert(customFields)
      .values({
        productId: product.id,
        key: "seats",
        label: "Seats",
        type: "number",
        required: false,
      })
      .returning({ id: customFields.id });
    const fieldId = seats[0]?.id;
    if (!fieldId) throw new Error("Custom field insert returned no row.");

    const ten = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const two = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const missing = await createFeedbackPost({ productId: product.id, boardId: board.id });

    await db.insert(feedbackCustomFieldValues).values([
      { productId: product.id, feedbackPostId: ten.id, fieldId, numberValue: 10 },
      { productId: product.id, feedbackPostId: two.id, fieldId, numberValue: 2 },
    ]);

    const pageOne = await call(
      token,
      "GET",
      "/requests?limit=2&sort=custom_field_asc:seats",
    );
    expect(pageOne.status).toBe(200);
    expect((pageOne.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      two.id,
      ten.id,
    ]);
    const cursor = (pageOne.body.pagination as { next_cursor: string | null })
      .next_cursor;
    expect(cursor).toBeTruthy();

    const pageTwo = await call(
      token,
      "GET",
      `/requests?limit=2&sort=custom_field_asc:seats&cursor=${encodeURIComponent(cursor ?? "")}`,
    );
    expect((pageTwo.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      missing.id,
    ]);

    const descending = await call(
      token,
      "GET",
      "/requests?sort=custom_field_desc:seats",
    );
    expect((descending.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      ten.id,
      two.id,
      missing.id,
    ]);

    const unknown = await call(token, "GET", "/requests?sort=custom_field_asc:nope");
    expect(unknown.status).toBe(400);
  });

  isolatedTest("replays an idempotent comment without writing twice", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);
    const request = await createFeedbackPost({ productId: product.id, boardId: board.id });

    const key = uniqueLabel("comment-key");
    const first = await call(
      token,
      "POST",
      `/requests/${request.id}/comments`,
      { body: "A reply that must happen once." },
      { "idempotency-key": key },
    );
    expect(first.status).toBe(201);
    const commentId = dataOf(first.body).id as string;

    const replay = await call(
      token,
      "POST",
      `/requests/${request.id}/comments`,
      { body: "A reply that must happen once." },
      { "idempotency-key": key },
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(dataOf(replay.body).id).toBe(commentId);

    const stored = await db
      .select({ id: feedbackComments.id })
      .from(feedbackComments)
      .where(eq(feedbackComments.feedbackPostId, request.id));
    expect(stored).toHaveLength(1);

    const reuse = await call(
      token,
      "POST",
      `/requests/${request.id}/comments`,
      { body: "A different reply with the same key." },
      { "idempotency-key": key },
    );
    expect(reuse.status).toBe(422);
    expect((reuse.body.error as { code: string }).code).toBe("idempotency_key_reused");
  });

  isolatedTest("request creation is idempotent and moderated for customers", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, {
      settings: {
        moderation: { requireApproval: "all", comments: "open", blockSensitiveInfo: false },
      },
    });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const key = uniqueLabel("request-key");
    const payload = {
      board_id: board.id,
      title: "A request created through the API",
      body: "It should exist exactly once.",
      customer: { external_id: "acme-user-1", email: "person@example.test" },
    };

    const first = await call(token, "POST", "/requests", payload, {
      "idempotency-key": key,
    });
    expect(first.status).toBe(201);
    expect(first.body.visibility).toBe("awaiting_review");

    const replay = await call(token, "POST", "/requests", payload, {
      "idempotency-key": key,
    });
    expect(replay.status).toBe(201);
    expect(dataOf(replay.body).id).toBe(dataOf(first.body).id);

    const stored = await db
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.boardId, board.id));
    expect(stored).toHaveLength(1);
  });

  isolatedTest("creates changelog drafts only and refuses to edit published rows", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const key = uniqueLabel("changelog-key");
    const slug = uniqueLabel("draft");
    const payload = {
      product_id: product.id,
      title: "Draft written by an agent",
      slug,
      summary: "A small update.",
      category: "improvement",
    };

    const first = await call(token, "POST", "/changelogs", payload, {
      "idempotency-key": key,
    });
    expect(first.status).toBe(201);
    const draft = dataOf(first.body);
    expect(draft.status).toBe("draft");

    const replay = await call(token, "POST", "/changelogs", payload, {
      "idempotency-key": key,
    });
    expect(replay.status).toBe(201);
    expect(dataOf(replay.body).id).toBe(draft.id);

    const drafts = await db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.productId, product.id), eq(releases.slug, slug)));
    expect(drafts).toHaveLength(1);

    const published = await createRelease({
      productId: product.id,
      status: "published",
      title: "Already shipped",
    });
    const patch = await call(token, "PATCH", `/changelogs/${published.id}`, {
      summary: "Trying to edit history.",
    });
    expect(patch.status).toBe(409);
  });

  isolatedTest("notes stay internal while replies are customer-facing", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const customer = await createCustomer(workspace.id, { email: "customer@example.test" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);
    const conversation = await createConversation({
      productId: product.id,
      workspaceId: workspace.id,
      customerId: customer.id,
      subject: "Need help",
    });

    const reply = await call(
      token,
      "POST",
      `/conversations/${conversation.id}/messages`,
      { body: "We are on it." },
      { "idempotency-key": uniqueLabel("reply-key") },
    );
    expect(reply.status).toBe(201);
    expect(dataOf(reply.body).kind).toBe("message");

    const note = await call(
      token,
      "POST",
      `/conversations/${conversation.id}/notes`,
      { body: "/refund is not a slash command here" },
      { "idempotency-key": uniqueLabel("note-key") },
    );
    expect(note.status).toBe(201);
    expect(dataOf(note.body).kind).toBe("note");

    const stored = await db
      .select({ kind: conversationMessages.kind, body: conversationMessages.body })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));

    expect(stored.map((row) => row.kind).sort()).toEqual(["message", "note"]);
    const savedNote = stored.find((row) => row.kind === "note");
    expect(savedNote?.body).toBe("/refund is not a slash command here");
  });

  isolatedTest("assigns a conversation to a member whose id is not a uuid", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const customer = await createCustomer(workspace.id, { email: "customer@example.test" });
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const { user: teammate } = await createMember(workspace.id, { role: "editor" });
    const token = await mintToken(workspace.id, owner.id);
    const conversation = await createConversation({
      productId: product.id,
      workspaceId: workspace.id,
      customerId: customer.id,
      subject: "Assign me",
    });

    // Better Auth issues opaque string user ids by default; the factory keeps
    // that shape so this guard fails if the API starts demanding a uuid again.
    expect(teammate.id).not.toMatch(/^[0-9a-f-]{36}$/i);

    const assigned = await call(token, "PATCH", `/conversations/${conversation.id}`, {
      assignee_id: teammate.id,
    });
    expect(assigned.status).toBe(200);

    const [saved] = await db
      .select({ assigneeId: conversations.assigneeId })
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(saved?.assigneeId).toBe(teammate.id);
  });

  isolatedTest("manages boards, tags, votes and companies", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const boardResponse = await call(token, "POST", "/boards", {
      product_id: product.id,
      name: "Feature Requests",
      description: "Ask for things.",
    });
    expect(boardResponse.status).toBe(201);
    const board = dataOf(boardResponse.body);
    expect(board.slug).toBe("feature-requests");

    const patchedBoard = await call(token, "PATCH", `/boards/${board.id as string}`, {
      description: "Ask for better things.",
    });
    expect(patchedBoard.status).toBe(200);
    expect(dataOf(patchedBoard.body).description).toBe("Ask for better things.");

    const tagResponse = await call(token, "POST", "/tags", {
      board_id: board.id,
      name: "api",
      color: "#2563eb",
    });
    expect(tagResponse.status).toBe(201);
    const tagId = dataOf(tagResponse.body).id as string;

    const tags = await call(token, "GET", `/tags?board=${board.id as string}`);
    expect((tags.body.data as { id: string }[]).map((row) => row.id)).toEqual([tagId]);

    const removedTag = await call(token, "DELETE", `/tags/${tagId}`);
    expect(removedTag.status).toBe(200);

    const request = await createFeedbackPost({
      productId: product.id,
      boardId: board.id as string,
    });

    const voted = await call(token, "POST", `/requests/${request.id}/votes`, {
      customer: { external_id: "voter-1" },
    });
    expect(voted.status).toBe(200);
    expect(dataOf(voted.body)).toMatchObject({ voted: true, vote_count: 1 });

    const unvoted = await call(
      token,
      "DELETE",
      `/requests/${request.id}/votes?external_id=voter-1`,
    );
    expect(unvoted.status).toBe(200);
    expect(dataOf(unvoted.body)).toMatchObject({ voted: false, vote_count: 0 });

    const companyResponse = await call(token, "POST", "/companies", {
      name: "Acme Inc",
      domain: "acme.test",
    });
    expect(companyResponse.status).toBe(201);
    const companyId = dataOf(companyResponse.body).id as string;

    const attached = await call(token, "POST", `/companies/${companyId}/customers`, {
      customer: { email: "buyer@acme.test", name: "Buyer" },
      role: "champion",
    });
    expect(attached.status).toBe(201);
    const detail = dataOf(attached.body) as { customers: { email: string | null }[] };
    expect(detail.customers.map((row) => row.email)).toEqual(["buyer@acme.test"]);

    const companies = await call(token, "GET", "/companies?q=Acme");
    expect((companies.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      companyId,
    ]);
  });

  isolatedTest("requires a read scope and rejects missing tokens", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const readOnly = await mintToken(workspace.id, user.id, ["read"]);

    const list = await call(readOnly, "GET", "/members");
    expect(list.status).toBe(200);

    const write = await call(readOnly, "POST", "/requests", {
      board_id: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
      title: "Not allowed",
      body: "No write scope.",
    });
    expect(write.status).toBe(403);

    const request = new NextRequest(new URL("http://localhost/api/v1/members"), {
      headers: { authorization: "Bearer not-a-herald-token" },
    });
    const response = await handleApiRequest(request, {
      params: Promise.resolve({ segments: ["members"] }),
    });
    expect(response.status).toBe(401);
  });
});
