import { describe, expect, test } from "bun:test";

import {
  buildSignedStoragePath,
  signStorageKey,
  verifyStorageSignature,
} from "@/features/storage/signed";

const secret = "test-only-storage-secret-0123456789";
const key = "workspaces/ws/products/product/attachment/file.png";
const now = 1_700_000_000_000;
const expiresAt = now + 60_000;

function signature(overrides: { key?: string; expiresAt?: number; secret?: string } = {}) {
  return signStorageKey({
    key: overrides.key ?? key,
    expiresAt: overrides.expiresAt ?? expiresAt,
    secret: overrides.secret ?? secret,
  });
}

describe("storage signatures", () => {
  test("verifies a valid, unexpired signature", () => {
    expect(
      verifyStorageSignature({
        key,
        expiresAt,
        signature: signature(),
        secret,
        now,
      }),
    ).toBe(true);
  });

  test("rejects a different key or expiry", () => {
    expect(
      verifyStorageSignature({
        key: `${key}.other`,
        expiresAt,
        signature: signature(),
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyStorageSignature({
        key,
        expiresAt: expiresAt + 1,
        signature: signature(),
        secret,
        now,
      }),
    ).toBe(false);
  });

  test("rejects expired and over-long URLs", () => {
    expect(
      verifyStorageSignature({
        key,
        expiresAt,
        signature: signature(),
        secret,
        now: expiresAt,
      }),
    ).toBe(false);
    expect(
      verifyStorageSignature({
        key,
        expiresAt: now + 25 * 60 * 60 * 1000,
        signature: signature({ expiresAt: now + 25 * 60 * 60 * 1000 }),
        secret,
        now,
      }),
    ).toBe(false);
  });

  test("rejects a tampered signature and a different secret", () => {
    const sig = signature();
    const tampered = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyStorageSignature({ key, expiresAt, signature: tampered, secret, now })).toBe(
      false,
    );
    expect(
      verifyStorageSignature({
        key,
        expiresAt,
        signature: signature({ secret: `${secret}-other` }),
        secret,
        now,
      }),
    ).toBe(false);
  });
});

describe("buildSignedStoragePath", () => {
  test("encodes key segments and includes expiry and signature", () => {
    const path = buildSignedStoragePath({
      key: "workspaces/ws/file name.png",
      expiresAt,
      signature: "sig",
    });
    expect(path).toBe(
      `/api/storage/workspaces/ws/file%20name.png?expires=${expiresAt}&signature=sig`,
    );
  });
});
