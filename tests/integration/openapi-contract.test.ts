import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { openApiDocument } from "@/features/api-v1/openapi";
import { handleApiRequest } from "@/features/api-v1/router";
import { API_ROUTE_DEFINITIONS } from "@/features/api-v1/routes";
import { createApiTokenMaterial } from "@/features/api-v1/token";

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
 * The published contract and the reachable contract must be the same list.
 *
 * `openApiDocument.paths` is built from the manifest, so the first assertion
 * would catch a path that was documented by hand and never routed. The second
 * assertion goes further and calls every documented operation through
 * `handleApiRequest`: a route whose path matched a page but whose handler
 * switch forgot the verb would answer "Endpoint not found", which is exactly
 * what this test refuses.
 *
 * Bodies are deliberately empty where a body is expected. A 400 from the
 * validator proves the request reached the operation; writing a fixture per
 * endpoint would test the handlers, which the API suite already does.
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

function segmentsFor(path: string): string[] {
  return path.replace(/^\//, "").split("/").filter(Boolean);
}

async function mintToken(workspaceId: string, userId: string): Promise<string> {
  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId,
      name: "Contract token",
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: ["read", "write"],
      createdBy: userId,
    })
    .returning({ id: apiTokens.id });
  if (!rows[0]) throw new Error("Token insert returned no row.");
  return material.token;
}

type DocumentedOperation = {
  path: string;
  method: "get" | "post" | "patch" | "delete";
  operationId: string;
};

function documentedOperations(): DocumentedOperation[] {
  const operations: DocumentedOperation[] = [];
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of ["get", "post", "patch", "delete"] as const) {
      const operation = (item as Record<string, unknown>)[method];
      if (!operation || typeof operation !== "object") continue;
      const operationId = (operation as { operationId?: unknown }).operationId;
      operations.push({
        path,
        method,
        operationId: typeof operationId === "string" ? operationId : "",
      });
    }
  }
  return operations;
}

async function call(
  token: string,
  method: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new NextRequest(new URL(`http://localhost/api/v1${path}`), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === "POST" || method === "PATCH"
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(method === "POST" || method === "PATCH" ? { body: "{}" } : {}),
  });

  const response = await handleApiRequest(request, {
    params: Promise.resolve({ segments: segmentsFor(path) }),
  });

  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

function errorMessage(body: Record<string, unknown>): string {
  const error = body.error;
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

describe("OpenAPI contract", () => {
  test("the served document and the route manifest are the same set", () => {
    const documented = new Set(
      documentedOperations().map((item) => `${item.method.toUpperCase()} ${item.path}`),
    );
    const manifest = new Set(
      API_ROUTE_DEFINITIONS.map((item) => `${item.method} ${item.path}`),
    );

    expect([...documented].sort()).toEqual([...manifest].sort());
    expect(documented.size).toBeGreaterThan(20);
  });

  isolatedTest(
    "every documented operation is reachable and answers",
    async () => {
      const workspace = await createWorkspace({ plan: "pro" });
      const product = await createProduct(workspace.id);
      await createBoard(product.id);
      const { user } = await createMember(workspace.id, { role: "owner" });
      const token = await mintToken(workspace.id, user.id);

      const failures: string[] = [];
      for (const operation of documentedOperations()) {
        const path = operation.path.replace(/\{[^}]+\}/g, () => randomUUID());
        const response = await call(token, operation.method.toUpperCase(), path);

        // "Endpoint not found." is the router saying the documented path is
        // not wired. "Board not found." and friends mean it was reached.
        if (response.status === 404 && errorMessage(response.body) === "Endpoint not found.") {
          failures.push(`${operation.method.toUpperCase()} ${operation.path}`);
        }
      }

      expect(failures).toEqual([]);
    },
    120_000,
  );

  isolatedTest("a documented path with a foreign-shaped id never returns a row", async () => {
    // The API is a paid surface; a free workspace answers 403 before lookup.
    const workspace = await createWorkspace({ plan: "pro" });
    await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    for (const path of ["/requests/{id}", "/boards/{id}", "/conversations/{id}"]) {
      const response = await call(
        token,
        "GET",
        path.replace(/\{[^}]+\}/g, () => randomUUID()),
      );
      expect(response.status).toBe(404);
      expect(errorMessage(response.body)).not.toContain("Endpoint");
    }
  });
});
