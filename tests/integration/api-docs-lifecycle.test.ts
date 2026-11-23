import { afterAll, beforeAll, describe, expect } from "bun:test";

import { NextRequest } from "next/server";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { POST as playgroundPost } from "@/app/api/public/api-docs/playground/route";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import {
  getPublicApiDoc,
  importApiDocVersion,
  listPublicApiDocs,
  publishApiDocVersion,
} from "@/features/api-docs/service";

import {
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
 * OpenAPI imports become public doc pages only after an explicit publish, and
 * the playground proxy refuses a write for a read-only token even though the
 * browser could construct the request.
 */

const previousApiFlag = process.env.FLAG_API;

beforeAll(async () => {
  process.env.FLAG_API = "on";
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousApiFlag === undefined) delete process.env.FLAG_API;
  else process.env.FLAG_API = previousApiFlag;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

function document(version: string, includePost: boolean) {
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Widgets", version },
    paths: {
      "/api/v1/widgets": {
        get: { summary: "List widgets", responses: { "200": { description: "OK" } } },
        ...(includePost
          ? {
              post: {
                summary: "Create a widget",
                responses: { "201": { description: "Created" } },
              },
            }
          : {}),
      },
    },
  });
}

describe("OpenAPI lifecycle and playground scope", () => {
  isolatedTest("a draft is private until published as the live versioned page", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });

    const first = await importApiDocVersion({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      docSlug: "widgets",
      name: "Widgets API",
      raw: document("1.0.0", true),
      version: "1.0.0",
      source: "file",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(
      await getPublicApiDoc({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        docSlug: "widgets",
      }),
    ).toBeNull();
    expect(
      await listPublicApiDocs({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
      }),
    ).toMatchObject({ docs: [] });

    const published = await publishApiDocVersion({
      productId: product.id,
      versionId: first.data.versionId,
      confirmBreaking: false,
    });
    expect(published.ok).toBe(true);

    const live = await getPublicApiDoc({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      docSlug: "widgets",
    });
    expect(live?.doc.version).toBe("1.0.0");
    expect(live?.doc.operations.map((operation) => operation.method)).toEqual([
      "GET",
      "POST",
    ]);

    const second = await importApiDocVersion({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      docSlug: "widgets",
      raw: document("1.1.0", false),
      version: "1.1.0",
      source: "file",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.breaking).toBe(true);

    // A draft never replaces the live page before publication.
    expect(
      (
        await getPublicApiDoc({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          docSlug: "widgets",
        })
      )?.doc.version,
    ).toBe("1.0.0");

    const refused = await publishApiDocVersion({
      productId: product.id,
      versionId: second.data.versionId,
      confirmBreaking: false,
    });
    expect(refused.ok).toBe(false);

    const republished = await publishApiDocVersion({
      productId: product.id,
      versionId: second.data.versionId,
      confirmBreaking: true,
    });
    expect(republished.ok).toBe(true);
    expect(
      (
        await getPublicApiDoc({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          docSlug: "widgets",
        })
      )?.doc.version,
    ).toBe("1.1.0");
  });

  isolatedTest("the playground proxy refuses a write for a read-only token", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const material = createApiTokenMaterial();
    await db.insert(apiTokens).values({
      workspaceId: workspace.id,
      name: "Read only",
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: ["read"],
      createdBy: user.id,
    });

    const response = await playgroundPost(
      new NextRequest("http://localhost/api/public/api-docs/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: material.token,
          method: "POST",
          path: "/api/v1/requests",
          body: JSON.stringify({ title: "Should never be sent" }),
        }),
      }),
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(payload.error?.code).toBe("forbidden");
    expect(payload.error?.message).toContain("write");
  });
});
