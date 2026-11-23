import { afterAll, beforeAll, describe, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { GET } from "@/app/api/release-images/[...key]/route";
import { inlineImagePath } from "@/features/releases/inline-images";
import { storeUpload } from "@/features/storage/upload";

import { createProduct, createRelease, createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Inline images must be readable from a published changelog without a session,
 * while still coming from the storage module rather than a data URL.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

let storageDir = "";
let previousStorageDir: string | undefined;

beforeAll(async () => {
  previousStorageDir = process.env.STORAGE_DIR;
  storageDir = mkdtempSync(path.join(tmpdir(), "herald-inline-images-"));
  process.env.STORAGE_DIR = storageDir;
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
  if (previousStorageDir === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorageDir;
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
}, SETUP_TIMEOUT_MS);

describe("public inline release images", () => {
  isolatedTest("serves an image referenced by a published changelog entry", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    const uploaded = await storeUpload({
      workspaceId: workspace.id,
      productId: product.id,
      kind: "image",
      fileName: "screenshot.png",
      mimeType: "image/png",
      body: PNG,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const url = inlineImagePath(uploaded.object.key);
    await createRelease({
      productId: product.id,
      status: "published",
      body: `### What changed\n\n![Screenshot](${url})\n\nA visible change.`,
      channelPublicChangelog: true,
    });

    const response = await GET(new Request(`http://localhost${url}`), {
      params: Promise.resolve({ key: uploaded.object.key.split("/") }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });
});
