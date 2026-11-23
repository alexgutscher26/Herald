import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { products } from "@/db/schema";
import { authenticateApiRequest, requireScope } from "@/features/api-v1/auth";
import { ApiFailure } from "@/features/api-v1/http";
import {
  importApiDocVersion,
  publishApiDocVersion,
} from "@/features/api-docs/service";
import { openApiTitle, parseOpenApiDocument } from "@/features/api-docs/openapi-lib";

export const dynamic = "force-dynamic";

/**
 * CI import for a versioned OpenAPI document.
 *
 * The workspace comes from the bearer token, never the path. The token needs
 * the `write` scope. The import always creates a draft; `publish` is explicit
 * and a breaking diff still needs `confirmBreaking`.
 */
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceSlug: string; productSlug: string; docSlug: string }>;
  },
) {
  const { workspaceSlug, productSlug, docSlug } = await params;

  try {
    const auth = await authenticateApiRequest(request);
    if (auth.workspaceSlug !== workspaceSlug) {
      throw new ApiFailure(404, "not_found", "Product not found.");
    }
    requireScope(auth, "write");

    const productRows = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.workspaceId, auth.workspaceId), eq(products.slug, productSlug)))
      .limit(1);
    const product = productRows[0];
    if (!product) throw new ApiFailure(404, "not_found", "Product not found.");

    const rawBody = await request.text();
    if (rawBody.length > 5_000_000) {
      throw new ApiFailure(400, "invalid_request", "The document is too large.");
    }
    let body: {
      document?: unknown;
      version?: unknown;
      publish?: unknown;
      confirmBreaking?: unknown;
      name?: unknown;
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      throw new ApiFailure(400, "invalid_request", "Send a JSON body with a document field.");
    }
    if (!body.document) {
      throw new ApiFailure(400, "invalid_request", "document is required.");
    }

    const raw =
      typeof body.document === "string" ? body.document : JSON.stringify(body.document);
    const document = parseOpenApiDocument(raw);
    const version =
      typeof body.version === "string" && body.version.trim()
        ? body.version.trim()
        : typeof (document.info as { version?: unknown }).version === "string"
          ? String((document.info as { version?: string }).version)
          : new Date().toISOString().slice(0, 10);

    const imported = await importApiDocVersion({
      workspaceId: auth.workspaceId,
      productId: product.id,
      userId: auth.userId,
      docSlug,
      name: typeof body.name === "string" ? body.name : openApiTitle(document),
      raw,
      version,
      source: "ci",
    });
    if (!imported.ok) {
      throw new ApiFailure(422, "validation_failed", imported.error);
    }

    let published = false;
    if (body.publish === true) {
      const result = await publishApiDocVersion({
        productId: product.id,
        versionId: imported.data.versionId,
        confirmBreaking: body.confirmBreaking === true,
      });
      if (!result.ok) {
        throw new ApiFailure(409, "conflict", result.error);
      }
      published = true;
    }

    return NextResponse.json(
      {
        data: {
          docId: imported.data.docId,
          versionId: imported.data.versionId,
          version,
          breaking: imported.data.breaking,
          changes: imported.data.changes,
          published,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ApiFailure) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error("[api-docs] ci import failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Could not import the OpenAPI document." } },
      { status: 500 },
    );
  }
}
