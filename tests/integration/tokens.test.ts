import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { authenticateApiRequest } from "@/features/api-v1/auth";
import { serializeToken } from "@/features/api-v1/serialize";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import { rotateApiToken } from "@/features/api-v1/token-rotation";

import { createMember, createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Token rotation against real Postgres: both the old and new secrets must work
 * during grace, the old one must stop exactly at `revoked_at`, and last use
 * must be visible for the audit view.
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

async function issueToken(workspaceId: string, userId: string) {
  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId,
      name: "Rotation test",
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: ["read", "write"],
      createdBy: userId,
    })
    .returning({ id: apiTokens.id });
  if (!rows[0]) throw new Error("Token insert returned no row.");
  return { id: rows[0].id, raw: material.token };
}

async function authenticates(raw: string): Promise<boolean> {
  try {
    await authenticateApiRequest(
      new Request("http://localhost/api/v1/members", {
        headers: { authorization: `Bearer ${raw}` },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

describe("API token rotation", () => {
  isolatedTest("keeps both tokens working during the grace period", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const previous = await issueToken(workspace.id, user.id);

    expect(await authenticates(previous.raw)).toBe(true);
    const [used] = await db
      .select({ lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, previous.id));
    expect(used?.lastUsedAt).toBeInstanceOf(Date);

    const rotated = await rotateApiToken({
      workspaceId: workspace.id,
      userId: user.id,
      tokenId: previous.id,
      graceHours: 2,
    });
    if (!rotated.ok) throw new Error(rotated.error);

    expect(await authenticates(previous.raw)).toBe(true);
    expect(await authenticates(rotated.token)).toBe(true);

    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.workspaceId, workspace.id));
    const oldRow = rows.find((row) => row.id === previous.id);
    const newRow = rows.find((row) => row.id === rotated.apiToken.id);

    expect(newRow?.rotatedFromId).toBe(previous.id);
    expect(newRow?.revokedAt).toBeNull();
    expect(oldRow?.revokedAt?.getTime()).toBeGreaterThan(Date.now() + 90 * 60 * 1000);
    expect(serializeToken(newRow!)).toMatchObject({
      status: "active",
      rotated_from_id: previous.id,
    });
    expect(serializeToken(newRow!).last_used_at).toEqual(expect.any(String));
    expect(serializeToken(oldRow!)).toMatchObject({ status: "retiring" });
  });

  isolatedTest("stops the old token at retirement and refuses to rotate it again", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const previous = await issueToken(workspace.id, user.id);

    const rotated = await rotateApiToken({
      workspaceId: workspace.id,
      userId: user.id,
      tokenId: previous.id,
      graceHours: 0,
    });
    if (!rotated.ok) throw new Error(rotated.error);

    expect(await authenticates(previous.raw)).toBe(false);
    expect(await authenticates(rotated.token)).toBe(true);

    const again = await rotateApiToken({
      workspaceId: workspace.id,
      userId: user.id,
      tokenId: previous.id,
      graceHours: 24,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_retired");
  });

  isolatedTest("does not rotate a token from another workspace", async () => {
    const first = await createWorkspace({ plan: "pro" });
    const second = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(first.id, { role: "owner" });
    const token = await issueToken(first.id, user.id);

    const result = await rotateApiToken({
      workspaceId: second.id,
      userId: user.id,
      tokenId: token.id,
      graceHours: 24,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });
});
