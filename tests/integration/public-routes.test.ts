import { afterAll, beforeAll, describe, expect } from "bun:test";

import { NextRequest } from "next/server";

import {
  GET as readSession,
  POST as createSession,
} from "@/app/api/public/session/route";
import { GET as readBoard } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/route";
import { getServerEnv } from "@/lib/env";

import {
  createBoard,
  createFeedbackPost,
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
 * The public surface is an HTTP contract, so these tests call the route
 * handlers rather than only the queries behind them. A guest must be able to
 * get a session and read a board, and every unavailable board — foreign,
 * private, archived or missing — must be the same 404.
 */

const SESSION_URL = "http://app.local/api/public/session";
const BOARD_URL = "http://app.local/api/public/boards";

let origin: string;
let previousUrl: string | undefined;
let previousSecret: string | undefined;

beforeAll(async () => {
  previousUrl = process.env.BETTER_AUTH_URL;
  previousSecret = process.env.BETTER_AUTH_SECRET;

  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";

  await setupTestDatabase();
  origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousUrl;
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;

  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

function boardRequest(path: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
}): Request {
  return new Request(
    `${BOARD_URL}/${path.workspaceSlug}/${path.productSlug}/${path.boardSlug}`,
  );
}

function boardParams(path: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
}) {
  return { params: Promise.resolve(path) };
}

function sessionRequest(workspaceSlug: string): NextRequest {
  return new NextRequest(SESSION_URL, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug }),
  });
}

function sessionCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const raw = cookies.find((value) => value.startsWith("herald_customer_session="));
  if (!raw) throw new Error("The session response did not set a cookie.");
  return raw;
}

type SessionBody = {
  session: {
    workspaceId: string;
    guest: boolean;
    customer: { id: string; email: string | null; verified: boolean };
  } | null;
};

describe("guest customer sessions", () => {
  isolatedTest("creates an anonymous session for a public workspace", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    const post = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Dark mode",
    });

    const response = await createSession(sessionRequest(workspace.slug));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const setCookie = sessionCookie(response);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");

    const body = (await response.json()) as SessionBody;
    expect(body.session?.guest).toBe(true);
    expect(body.session?.workspaceId).toBe(workspace.id);
    expect(body.session?.customer.email).toBeNull();
    expect(body.session?.customer.verified).toBe(false);

    const cookie = setCookie.split(";")[0] ?? "";

    const current = await readSession(
      new NextRequest(SESSION_URL, { headers: { cookie } }),
    );
    const currentBody = (await current.json()) as SessionBody;
    expect(currentBody.session?.customer.id).toBe(body.session?.customer.id);
    expect(currentBody.session?.guest).toBe(true);

    // A guest can read the board it just joined, with no dashboard identity.
    const page = await readBoard(
      new Request(`${BOARD_URL}/${workspace.slug}/${product.slug}/${board.slug}`, {
        headers: { cookie },
      }),
      boardParams({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: board.slug,
      }),
    );
    expect(page.status).toBe(200);

    const pageBody = (await page.json()) as { requests: { id: string }[] };
    expect(pageBody.requests.map((request) => request.id)).toEqual([post.id]);
  });

  isolatedTest("refuses to create a session for a workspace with no public board", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    await createBoard(product.id, { slug: "private", visibility: "private" });

    const response = await createSession(sessionRequest(workspace.slug));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe(
      "Workspace not found.",
    );
  });
});

describe("public board HTTP responses", () => {
  isolatedTest("returns the same 404 for foreign, private, archived and missing boards", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const publicBoard = await createBoard(product.id, { slug: "feedback" });
    await createBoard(product.id, { slug: "private", visibility: "private" });
    await createBoard(product.id, { slug: "retired", archivedAt: new Date() });
    await createFeedbackPost({
      productId: product.id,
      boardId: publicBoard.id,
      title: "Public request",
    });

    const foreign = await createWorkspace();
    const foreignProduct = await createProduct(foreign.id);
    await createBoard(foreignProduct.id, { slug: "feedback" });

    const paths = {
      own: {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: publicBoard.slug,
      },
      foreignWorkspace: {
        workspaceSlug: foreign.slug,
        productSlug: product.slug,
        boardSlug: publicBoard.slug,
      },
      privateBoard: {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: "private",
      },
      archivedBoard: {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: "retired",
      },
      missingBoard: {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: "does-not-exist",
      },
    };

    const own = await readBoard(boardRequest(paths.own), boardParams(paths.own));
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { requests: unknown[] };
    expect(ownBody.requests).toHaveLength(1);

    const denied = [
      paths.foreignWorkspace,
      paths.privateBoard,
      paths.archivedBoard,
      paths.missingBoard,
    ];

    const responses = await Promise.all(
      denied.map((path) => readBoard(boardRequest(path), boardParams(path))),
    );

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0] ?? "")).toEqual({ error: "Board not found." });
  });
});
