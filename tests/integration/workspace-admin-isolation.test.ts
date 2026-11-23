import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { workspaceMembers } from "@/db/schema/workspaces";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import { rotateApiToken } from "@/features/api-v1/token-rotation";
import { parseAuditFilters } from "@/features/data-controls/audit-filters";
import {
  buildWorkspaceExport,
  listWorkspaceAuditEvents,
  recordWorkspaceAudit,
  transferWorkspaceOwnership,
} from "@/features/data-controls/service";
import {
  getDomainClaim,
  removeDomainClaim,
  saveDomainClaim,
} from "@/features/workspace-settings/domain-claims";
import {
  changeWorkspaceMemberRole,
  createWorkspaceInvitation,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from "@/features/workspace-settings/invitations";
import { revokeApiTokensForLostAccess } from "@/features/workspace-settings/token-revocation";

import {
  createBoard,
  createFeedbackPost,
  createMember,
  createProduct,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Cross-tenant contracts for the workspace-administration mutations added in
 * this batch. The model is `tests/integration/cross-tenant.test.ts`: a real id
 * from a second tenant is passed into every path and must behave like a missing
 * row — no read, no mutation, no existence signal.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  process.env.BETTER_AUTH_URL = "http://app.local";
  process.env.BETTER_AUTH_SECRET = "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function issueToken(workspaceId: string, userId: string) {
  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId,
      name: uniqueLabel("token"),
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: ["read", "write"],
      createdBy: userId,
    })
    .returning({ id: apiTokens.id, prefix: apiTokens.prefix });
  const row = rows[0];
  if (!row) throw new Error("Token insert returned no row.");
  return row;
}

describe("cross-tenant member administration", () => {
  isolatedTest("role changes and removals refuse a member from another workspace", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });
    const { member: bEditor } = await createMember(b.id, { role: "editor" });

    expect(
      await changeWorkspaceMemberRole({
        workspaceId: a.id,
        memberId: bEditor.id,
        role: "viewer",
        actorUserId: aOwner.id,
      }),
    ).toEqual({ ok: false, error: "Member not found." });

    expect(
      await removeWorkspaceMember({
        workspaceId: a.id,
        memberId: bEditor.id,
        actorUserId: aOwner.id,
      }),
    ).toEqual({ ok: false, error: "Member not found." });

    const untouched = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.id, bEditor.id));
    expect(untouched[0]?.role).toBe("editor");
  });

  isolatedTest("invitation resend and revoke refuse an invitation from another workspace", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });
    const { user: bOwner } = await createMember(b.id, { role: "owner" });

    const created = await createWorkspaceInvitation({
      workspaceId: b.id,
      workspaceName: b.name,
      workspaceSlug: b.slug,
      invitedBy: bOwner.id,
      inviterName: "B owner",
      email: `${uniqueLabel("invite")}@example.test`,
      role: "viewer",
    });
    if (!created.ok) throw new Error(created.error);

    expect(
      await resendWorkspaceInvitation({
        workspaceId: a.id,
        workspaceName: a.name,
        workspaceSlug: a.slug,
        invitationId: created.invitation.id,
        invitedBy: aOwner.id,
        inviterName: "A owner",
      }),
    ).toEqual({ ok: false, error: "Invitation not found." });

    expect(
      await revokeWorkspaceInvitation({
        workspaceId: a.id,
        invitationId: created.invitation.id,
      }),
    ).toBe(false);

    // The owner's own workspace can still revoke it.
    expect(
      await revokeWorkspaceInvitation({
        workspaceId: b.id,
        invitationId: created.invitation.id,
      }),
    ).toBe(true);
  });

  isolatedTest("ownership transfer refuses a member from another workspace", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });
    const { member: bMember } = await createMember(b.id, { role: "editor" });

    expect(
      await transferWorkspaceOwnership({
        workspaceId: a.id,
        actorUserId: aOwner.id,
        targetMemberId: bMember.id,
      }),
    ).toEqual({ ok: false, error: "Choose a teammate in this workspace." });

    const unchanged = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.id, bMember.id));
    expect(unchanged[0]?.role).toBe("editor");
  });
});

describe("last manager guard", () => {
  isolatedTest("a workspace with only an admin cannot demote or remove them", async () => {
    const workspace = await createWorkspace();
    const { member: admin, user: adminUser } = await createMember(workspace.id, {
      role: "admin",
    });

    const expected = {
      ok: false as const,
      error:
        "A workspace needs at least one owner or admin. Promote another member before changing this one.",
    };

    expect(
      await changeWorkspaceMemberRole({
        workspaceId: workspace.id,
        memberId: admin.id,
        role: "viewer",
        actorUserId: adminUser.id,
      }),
    ).toEqual(expected);

    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    expect(
      await removeWorkspaceMember({
        workspaceId: workspace.id,
        memberId: admin.id,
        actorUserId: owner.id,
      }),
    ).toMatchObject({ ok: true, role: "admin" });
  });
});

describe("token access follows the creator's role", () => {
  isolatedTest("demoting an admin revokes the tokens they created", async () => {
    const workspace = await createWorkspace();
    const { member: admin, user: adminUser } = await createMember(workspace.id, {
      role: "admin",
    });
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const token = await issueToken(workspace.id, adminUser.id);

    const demoted = await changeWorkspaceMemberRole({
      workspaceId: workspace.id,
      memberId: admin.id,
      role: "editor",
      actorUserId: owner.id,
    });
    expect(demoted).toMatchObject({ ok: true, tokensRevoked: 1 });

    const row = await db
      .select({ revokedAt: apiTokens.revokedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, token.id));
    expect(row[0]?.revokedAt).toBeInstanceOf(Date);
  });

  isolatedTest("revoking for lost access stays inside the named workspace", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user } = await createMember(a.id, { role: "admin" });
    await createMember(b.id, { role: "owner" });

    const inA = await issueToken(a.id, user.id);
    const inB = await issueToken(b.id, user.id);

    const revoked = await revokeApiTokensForLostAccess({
      workspaceId: a.id,
      userId: user.id,
      reason: "test",
    });
    expect(revoked).toEqual([inA.id]);

    const bRow = await db
      .select({ revokedAt: apiTokens.revokedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, inB.id));
    expect(bRow[0]?.revokedAt).toBeNull();
  });

  isolatedTest("rotating a token through the wrong workspace finds nothing", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });
    const { user: bOwner } = await createMember(b.id, { role: "owner" });
    const bToken = await issueToken(b.id, bOwner.id);

    const result = await rotateApiToken({
      workspaceId: a.id,
      userId: aOwner.id,
      tokenId: bToken.id,
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });

    const row = await db
      .select({ revokedAt: apiTokens.revokedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, bToken.id));
    expect(row[0]?.revokedAt).toBeNull();
  });
});

describe("audit, export and domain claims stay scoped", () => {
  isolatedTest("the audit query returns only this workspace and honours filters", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });

    await recordWorkspaceAudit({
      workspaceId: a.id,
      actorUserId: aOwner.id,
      action: "api_token.created",
      targetType: "api_token",
      targetId: "token-a",
      metadata: { scopes: "read" },
    });
    await recordWorkspaceAudit({
      workspaceId: b.id,
      actorUserId: null,
      action: "member.removed",
      targetType: "member",
      targetId: "member-b",
      metadata: { memberEmail: "b@example.test" },
    });

    const all = await listWorkspaceAuditEvents(a.id);
    expect(all.map((entry) => entry.action)).toEqual(["api_token.created"]);
    expect(all[0]?.actorEmail).toBe(aOwner.email);

    const created = await listWorkspaceAuditEvents(a.id, {
      filters: parseAuditFilters({ action: "api_token.created" }),
    });
    expect(created).toHaveLength(1);

    const removed = await listWorkspaceAuditEvents(a.id, {
      filters: parseAuditFilters({ action: "member.removed" }),
    });
    expect(removed).toHaveLength(0);

    const bySearch = await listWorkspaceAuditEvents(a.id, {
      filters: parseAuditFilters({ search: "token-a" }),
    });
    expect(bySearch).toHaveLength(1);
  });

  isolatedTest("a workspace export never contains another workspace's content", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const aProduct = await createProduct(a.id);
    const bProduct = await createProduct(b.id);
    const bBoard = await createBoard(bProduct.id, {
      slug: uniqueLabel("board"),
      name: "B board",
    });
    await createFeedbackPost({
      productId: bProduct.id,
      boardId: bBoard.id,
      title: "Workspace B confidential request",
    });

    const exported = await buildWorkspaceExport({ workspaceId: a.id });
    if (!exported) throw new Error("The export returned nothing.");

    expect(JSON.stringify(exported)).not.toContain("Workspace B confidential request");
    expect((exported.products as Array<{ id: string }>).map((row) => row.id)).toEqual([
      aProduct.id,
    ]);
  });

  isolatedTest("removing a domain claim touches only that workspace", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });
    const { user: bOwner } = await createMember(b.id, { role: "owner" });

    const aClaim = await saveDomainClaim({
      workspaceId: a.id,
      domain: `${uniqueLabel("a-claim")}.com`,
      role: "editor",
      createdBy: aOwner.id,
    });
    if (!aClaim.ok) throw new Error(aClaim.error);
    const bClaim = await saveDomainClaim({
      workspaceId: b.id,
      domain: `${uniqueLabel("b-claim")}.com`,
      role: "viewer",
      createdBy: bOwner.id,
    });
    if (!bClaim.ok) throw new Error(bClaim.error);

    expect(await removeDomainClaim(a.id)).toBe(true);
    expect(await getDomainClaim(a.id)).toBeNull();
    expect(await getDomainClaim(b.id)).not.toBeNull();
  });

  isolatedTest("a domain already claimed by another workspace cannot be claimed again", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const { user: aOwner } = await createMember(a.id, { role: "owner" });
    const { user: bOwner } = await createMember(b.id, { role: "owner" });
    const domain = `${uniqueLabel("acme")}.com`;

    const bClaim = await saveDomainClaim({
      workspaceId: b.id,
      domain,
      role: "viewer",
      createdBy: bOwner.id,
    });
    if (!bClaim.ok) throw new Error(bClaim.error);

    // The duplicate attempt is last: on Postgres a unique violation aborts the
    // surrounding test transaction even though the service turns it into a
    // typed error.
    expect(
      await saveDomainClaim({
        workspaceId: a.id,
        domain,
        role: "editor",
        createdBy: aOwner.id,
      }),
    ).toMatchObject({ ok: false });
  });
});
