import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { account, session, user } from "@/db/schema/auth";
import { workspaceMembers, workspaces } from "@/db/schema/workspaces";
import {
  getAccountSecuritySummary,
  listAccountDeletionBlockers,
} from "@/features/account/account-settings";
import { getAuth } from "@/lib/auth";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";
import { createMember, createUser, createWorkspace } from "./factories";

/**
 * Account deletion policy and cascade.
 *
 * Deleting a `user` row cascades to sessions, linked accounts and workspace
 * memberships, but not to workspaces. These tests pin the guard that stops that
 * cascade from leaving a workspace without an owner, and confirm what the
 * delete actually removes.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("account deletion blockers", () => {
  isolatedTest("a sole owner is blocked by the workspace", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });

    const blockers = await listAccountDeletionBlockers(owner.id);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.workspaceId).toBe(workspace.id);
    expect(blockers[0]?.slug).toBe(workspace.slug);
  });

  isolatedTest("an owner with another owner is not blocked", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    await createMember(workspace.id, { role: "owner" });

    expect(await listAccountDeletionBlockers(owner.id)).toEqual([]);
  });

  isolatedTest("a non-owner member is not blocked", async () => {
    const workspace = await createWorkspace();
    const { user: editor } = await createMember(workspace.id, { role: "editor" });

    expect(await listAccountDeletionBlockers(editor.id)).toEqual([]);
  });

  isolatedTest("only sole-owned workspaces are listed", async () => {
    const shared = await createWorkspace();
    const { user: owner } = await createMember(shared.id, { role: "owner" });
    await createMember(shared.id, { role: "owner" });

    const sole = await createWorkspace();
    await db.insert(workspaceMembers).values({
      workspaceId: sole.id,
      userId: owner.id,
      role: "owner",
    });

    const blockers = await listAccountDeletionBlockers(owner.id);
    expect(blockers.map((blocker) => blocker.workspaceId)).toEqual([sole.id]);
  });
});

describe("deleting an account", () => {
  isolatedTest("removes the user, sessions and memberships but keeps the workspace", async () => {
    const workspace = await createWorkspace();
    const { user: member } = await createMember(workspace.id, { role: "editor" });

    await db.insert(session).values({
      id: `ses_${crypto.randomUUID()}`,
      token: crypto.randomUUID(),
      userId: member.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await db.delete(user).where(eq(user.id, member.id));

    expect(await db.select().from(user).where(eq(user.id, member.id))).toHaveLength(0);
    expect(
      await db.select().from(session).where(eq(session.userId, member.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, member.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(workspaces).where(eq(workspaces.id, workspace.id)),
    ).toHaveLength(1);
  });
});

describe("delete endpoint", () => {
  isolatedTest("is enabled and refuses a request without a session", async () => {
    const error: unknown = await getAuth()
      .api.deleteUser({ body: { password: "irrelevant" } })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).not.toBeNull();
    // A disabled endpoint answers NOT_FOUND; without a session it is UNAUTHORIZED.
    const status = (error as { status?: unknown } | null)?.status;
    expect(status).not.toBe("NOT_FOUND");
    expect(String(status)).toBe("UNAUTHORIZED");
  });
});

describe("account security summary", () => {
  isolatedTest("reports whether the account has a password", async () => {
    const passwordUser = await createUser();
    const ssoUser = await createUser();

    await db.insert(account).values([
      {
        id: `acc_${crypto.randomUUID()}`,
        accountId: passwordUser.id,
        providerId: "credential",
        userId: passwordUser.id,
        password: "not-a-real-hash",
      },
      {
        id: `acc_${crypto.randomUUID()}`,
        accountId: ssoUser.id,
        providerId: "sso-saml",
        userId: ssoUser.id,
        password: null,
      },
    ]);

    expect(await getAccountSecuritySummary(passwordUser.id)).toEqual({
      hasPassword: true,
    });
    expect(await getAccountSecuritySummary(ssoUser.id)).toEqual({ hasPassword: false });
  });
});
