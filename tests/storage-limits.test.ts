import { describe, expect, test } from "bun:test";

import {
  MAX_UPLOAD_BYTES,
  buildStorageKey,
  isSafeStorageKey,
  safeFileName,
  sniffMimeType,
  validateUpload,
} from "@/features/storage/limits";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pdf = new TextEncoder().encode("%PDF-1.7\n");
const text = new TextEncoder().encode("hello world\n");

describe("sniffMimeType", () => {
  test("detects PNG, PDF and plain text is not guessed as a binary type", () => {
    expect(sniffMimeType(png)).toBe("image/png");
    expect(sniffMimeType(pdf)).toBe("application/pdf");
    expect(sniffMimeType(text)).toBeNull();
  });
});

describe("validateUpload", () => {
  test("accepts a verified PNG", () => {
    expect(
      validateUpload({
        kind: "cover",
        mimeType: "image/png",
        byteSize: png.byteLength,
        body: png,
      }),
    ).toEqual({ ok: true });
  });

  test("rejects contents that do not match the declared type", () => {
    const result = validateUpload({
      kind: "image",
      mimeType: "image/jpeg",
      byteSize: png.byteLength,
      body: png,
    });
    expect(result.ok).toBe(false);
  });

  test("rejects a binary file declared as text", () => {
    const result = validateUpload({
      kind: "attachment",
      mimeType: "text/plain",
      byteSize: 3,
      body: new Uint8Array([65, 0, 66]),
    });
    expect(result.ok).toBe(false);
  });

  test("rejects disallowed types and oversized files", () => {
    expect(
      validateUpload({ kind: "attachment", mimeType: "application/zip", byteSize: 10 }).ok,
    ).toBe(false);
    expect(
      validateUpload({
        kind: "image",
        mimeType: "image/png",
        byteSize: MAX_UPLOAD_BYTES.image + 1,
      }).ok,
    ).toBe(false);
  });

  test("rejects an incomplete body", () => {
    expect(
      validateUpload({
        kind: "image",
        mimeType: "image/png",
        byteSize: png.byteLength + 1,
        body: png,
      }).ok,
    ).toBe(false);
  });
});

describe("storage keys", () => {
  test("accepts generated segments and rejects traversal", () => {
    expect(isSafeStorageKey("workspaces/abc/products/def/image/file.png")).toBe(true);
    expect(isSafeStorageKey("../etc/passwd")).toBe(false);
    expect(isSafeStorageKey("/absolute/path")).toBe(false);
    expect(isSafeStorageKey("workspaces/abc\\..\\file")).toBe(false);
    expect(isSafeStorageKey("workspaces//file")).toBe(false);
  });

  test("builds a scoped key with the original extension", () => {
    expect(
      buildStorageKey({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        productId: "22222222-2222-4222-8222-222222222222",
        kind: "attachment",
        fileName: "Report.PDF",
        id: "33333333-3333-4333-8333-333333333333",
      }),
    ).toBe(
      "workspaces/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/attachment/33333333-3333-4333-8333-333333333333.pdf",
    );
  });

  test("strips paths and control characters from a display name", () => {
    expect(safeFileName("../../evil.txt")).toBe("evil.txt");
    expect(safeFileName("a\u0000b.png")).toBe("ab.png");
    expect(safeFileName("   ")).toBe("file");
  });
});
