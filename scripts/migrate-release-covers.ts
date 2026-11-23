import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { products } from "@/db/schema";
import { releases } from "@/db/schema/releases";
import { validateUpload } from "@/features/storage/limits";
import { storeUpload } from "@/features/storage/upload";

/**
 * Move release covers out of base64 `data:` URLs into the storage module.
 *
 * For every release whose `cover` still holds a `dataUrl`, the payload is
 * decoded, validated against the same magic-byte rules as an upload, stored
 * under the product's `cover/` prefix, and the row is rewritten to keep only
 * the generated key. The script is idempotent: a release without a `dataUrl` is
 * never touched, and a failure leaves its row unchanged.
 *
 * Run it before applying the migration that adds the "no inline image"
 * check constraints, because those constraints validate existing rows:
 *
 *   bun run db:migrate-release-covers
 *   bun run db:migrate
 */

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function decodeDataUrl(value: string): { mimeType: string; body: Uint8Array } | null {
  const match = DATA_URL.exec(value);
  if (!match) return null;

  const mimeType = match[1]!.toLowerCase();
  const body = new Uint8Array(Buffer.from(match[2]!.replace(/\s+/g, ""), "base64"));
  return body.byteLength > 0 ? { mimeType, body } : null;
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      releaseId: releases.id,
      cover: releases.cover,
      productId: releases.productId,
      workspaceId: products.workspaceId,
    })
    .from(releases)
    .innerJoin(products, eq(products.id, releases.productId))
    .where(sql`${releases.cover} ? 'dataUrl'`);

  if (rows.length === 0) {
    console.log("No release cover holds a data: URL. Nothing to migrate.");
    return;
  }

  let migrated = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const candidate = row.cover as unknown as { dataUrl?: unknown };
    const dataUrl = typeof candidate.dataUrl === "string" ? candidate.dataUrl : "";
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      failures.push(`${row.releaseId}: unrecognised data: URL`);
      continue;
    }

    const extension = EXTENSIONS[decoded.mimeType];
    if (!extension) {
      failures.push(`${row.releaseId}: unsupported cover type ${decoded.mimeType}`);
      continue;
    }

    const validation = validateUpload({
      kind: "cover",
      mimeType: decoded.mimeType,
      byteSize: decoded.body.byteLength,
      body: decoded.body,
    });
    if (!validation.ok) {
      failures.push(`${row.releaseId}: ${validation.error}`);
      continue;
    }

    const uploaded = await storeUpload({
      workspaceId: row.workspaceId,
      productId: row.productId,
      kind: "cover",
      fileName: `cover.${extension}`,
      mimeType: decoded.mimeType,
      body: decoded.body,
    });
    if (!uploaded.ok) {
      failures.push(`${row.releaseId}: ${uploaded.error}`);
      continue;
    }

    await db
      .update(releases)
      .set({ cover: { kind: "custom", key: uploaded.object.key } })
      .where(eq(releases.id, row.releaseId));

    migrated += 1;
    console.log(`${row.releaseId}: ${decoded.mimeType} → ${uploaded.object.key}`);
  }

  console.log(`Migrated ${migrated} of ${rows.length} cover(s).`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`Failed: ${failure}`);
    process.exitCode = 1;
  }
}

await main();
