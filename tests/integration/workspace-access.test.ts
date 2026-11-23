import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { getAuth } from "@/lib/auth";
import { session, user } from "@/db/schema/auth";
import { conversations } from "@/db/schema/conversations";
import { workspaceMembers } from "@/db/schema/workspaces";
import {
  listWorkspaceAuditEvents,
  recordWorkspaceAudit,
} from "@/features/data-controls/service";
import { deleteScimUser } from "@/features/enterprise/scim";
import {
  joinVerifiedDomainWorkspaces,
  normalizeEmailDomain,
} from "@/features/workspace-settings/domain-capture";
import { saveDomainClaim, verifyDomainClaim } from "@/features/workspace-settings/domain-claims";
import {
  acceptWorkspaceInvitation,
  changeWorkspaceMemberRole,
  createWorkspaceInvitation,
  getInvitationPreview,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
} from "@/features/workspace-settings/invitations";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";
import {
  createConversation,
  createCustomer,
  createMember,
  createProduct,
  createUser,
  createWorkspace,
  uniqueLabel,
} from "./factories";

/**
 * Team access: invitation lifecycle, the last-owner guard, SCIM deprovisioning
 * and domain capture.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

function tokenFromUrl(url: string): string {
  const raw = url.split("/invite/")[1];
  if (!raw) throw new Error(`No invitation token in ${url}`);
  return decodeURIComponent(raw);
}

async function invite(input: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  invitedBy: string;
  email: string;
  role: "admin" | "editor" | "viewer";
}): Promise<{ invitationId: string; token: string }> {
  const created = await createWorkspaceInvitation({
    ...input,
    inviterName: "Owner",
  });
  if (!created.ok) throw new Error(created.error);
  return { invitationId: created.invitation.id, token: tokenFromUrl(created.url) };
}

describe("invitation resend", () => {
  isolatedTest("issues a new link, retires the old one and extends expiry", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const email = `${uniqueLabel("invitee")}@example.test`;
    const first = await invite({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitedBy: owner.id,
      email,
      role: "editor",
    });

    const resent = await resendWorkspaceInvitation({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitationId: first.invitationId,
      invitedBy: owner.id,
      inviterName: owner.name,
    });
    expect(resent.ok).toBe(true);
    if (!resent.ok) return;
    const secondToken = tokenFromUrl(resent.url);

    expect(secondToken).not.toBe(first.token);
    expect(resent.invitation.id).toBe(first.invitationId);
    expect(await getInvitationPreview(first.token)).toBeNull();
    const preview = await getInvitationPreview(secondToken);
    expect(preview?.email).toBe(email);
    expect(preview?.role).toBe("editor");
    expect(new Date(preview?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000,
    );
  });

  isolatedTest("refuses to resend an invitation that was already accepted", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const email = `${uniqueLabel("invitee")}@example.test`;
    const created = await invite({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitedBy: owner.id,
      email,
      role: "editor",
    });
    const invitee = await createUser({ email });
    const accepted = await acceptWorkspaceInvitation({
      token: created.token,
      userId: invitee.id,
      userEmail: email,
    });
    expect(accepted.ok).toBe(true);

    const resent = await resendWorkspaceInvitation({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitationId: created.invitationId,
      invitedBy: owner.id,
      inviterName: owner.name,
    });
    expect(resent.ok).toBe(false);
    if (!resent.ok) expect(resent.error).toContain("already accepted");
  });
});

describe("invitation acceptance for an existing account", () => {
  isolatedTest("adds the membership and is single use", async () => {
    const workspace = await createWorkspace();
    await createMember(workspace.id, { role: "owner" });
    const email = `${uniqueLabel("existing")}@example.test`;
    const account = await createUser({ email });
    const created = await invite({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitedBy: account.id,
      email,
      role: "editor",
    });

    const first = await acceptWorkspaceInvitation({
      token: created.token,
      userId: account.id,
      userEmail: email,
    });
    expect(first).toEqual({ ok: true, workspaceSlug: workspace.slug });
    const membership = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, account.id),
        ),
      );
    expect(membership[0]?.role).toBe("editor");

    const second = await acceptWorkspaceInvitation({
      token: created.token,
      userId: account.id,
      userEmail: email,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already used");
  });

  isolatedTest("refuses a signed-in account whose address is not the invited one", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const created = await invite({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      invitedBy: owner.id,
      email: `${uniqueLabel("invitee")}@example.test`,
      role: "editor",
    });
    const other = await createUser({ email: `${uniqueLabel("someone")}@example.test` });

    const result = await acceptWorkspaceInvitation({
      token: created.token,
      userId: other.id,
      userEmail: other.email,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("email address this invitation was sent to");
  });
});

describe("last-owner guard", () => {
  isolatedTest("refuses to demote or remove the only owner", async () => {
    const workspace = await createWorkspace();
    const { member: ownerMember } = await createMember(workspace.id, { role: "owner" });
    const outsider = await createUser();

    const demote = await changeWorkspaceMemberRole({
      workspaceId: workspace.id,
      memberId: ownerMember.id,
      role: "admin",
      actorUserId: outsider.id,
    });
    expect(demote.ok).toBe(false);
    if (!demote.ok) expect(demote.error).toContain("Transfer ownership");

    const remove = await removeWorkspaceMember({
      workspaceId: workspace.id,
      memberId: ownerMember.id,
      actorUserId: outsider.id,
    });
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.error).toContain("Transfer ownership");
  });

  isolatedTest("allows the change once a second owner exists, and reports the previous role", async () => {
    const workspace = await createWorkspace();
    const { member: firstOwner, user: firstUser } = await createMember(workspace.id, {
      role: "owner",
    });
    const { user: secondOwner } = await createMember(workspace.id, { role: "owner" });

    const demoted = await changeWorkspaceMemberRole({
      workspaceId: workspace.id,
      memberId: firstOwner.id,
      role: "admin",
      actorUserId: secondOwner.id,
    });
    expect(demoted).toEqual({
      ok: true,
      previousRole: "owner",
      memberEmail: firstUser.email,
      tokensRevoked: 0,
    });

    const removed = await removeWorkspaceMember({
      workspaceId: workspace.id,
      memberId: firstOwner.id,
      actorUserId: secondOwner.id,
    });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.memberEmail).toBe(firstUser.email);
  });

  isolatedTest("refuses to let an owner change their own role", async () => {
    const workspace = await createWorkspace();
    const { member, user } = await createMember(workspace.id, { role: "owner" });
    await createMember(workspace.id, { role: "owner" });

    const result = await changeWorkspaceMemberRole({
      workspaceId: workspace.id,
      memberId: member.id,
      role: "editor",
      actorUserId: user.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Transfer ownership");
  });
});

describe("SCIM deprovisioning", () => {
  isolatedTest("revokes sessions, reassigns open conversations and removes the membership", async () => {
    const workspace = await createWorkspace();
    const { user: operator } = await createMember(workspace.id, { role: "owner" });
    const { member: departing, user: departingUser } = await createMember(workspace.id, {
      role: "editor",
    });
    const product = await createProduct(workspace.id);
    const customer = await createCustomer(workspace.id);
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      assigneeId: departingUser.id,
    });
    await db.insert(session).values({
      id: `ses_${crypto.randomUUID()}`,
      token: crypto.randomUUID(),
      userId: departingUser.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const removed = await deleteScimUser(workspace.id, departing.id, operator.id);
    expect(removed).toBe(true);

    expect(
      await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.id, departing.id)),
    ).toHaveLength(0);
    expect(
      await db.select({ id: session.id }).from(session).where(eq(session.userId, departingUser.id)),
    ).toHaveLength(0);
    const reassigned = await db
      .select({ assigneeId: conversations.assigneeId })
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(reassigned[0]?.assigneeId).toBe(operator.id);

    const audit = await listWorkspaceAuditEvents(workspace.id);
    const entry = audit.find((row) => row.action === "member.removed");
    expect(entry?.metadata?.source).toBe("scim");
    expect(entry?.metadata?.sessionsRevoked).toBe(true);
    expect(entry?.metadata?.memberEmail).toBe(departingUser.email);
  });

  isolatedTest("refuses to deprovision the only owner", async () => {
    const workspace = await createWorkspace();
    const { member: soleOwner } = await createMember(workspace.id, { role: "owner" });

    await expect(deleteScimUser(workspace.id, soleOwner.id, null)).rejects.toThrow(
      /last owner/i,
    );
    expect(
      await db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.id, soleOwner.id)),
    ).toHaveLength(1);
  });
});

describe("domain capture", () => {
  isolatedTest("normalizes company domains and rejects public mailbox providers", async () => {
    expect(normalizeEmailDomain("@Acme.COM")).toBe("acme.com");
    expect(normalizeEmailDomain("https://acme.com/careers")).toBe("acme.com");
    expect(normalizeEmailDomain("acme.com.")).toBe("acme.com");
    expect(normalizeEmailDomain("gmail.com")).toBeNull();
    expect(normalizeEmailDomain("not a domain")).toBeNull();
    expect(normalizeEmailDomain("127.0.0.1")).toBeNull();
  });

  isolatedTest("only a verified claim enrolls new accounts", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const domain = `${uniqueLabel("acme")}.test`;
    const saved = await saveDomainClaim({
      workspaceId: workspace.id,
      domain: `@${domain}`,
      role: "editor",
      createdBy: owner.id,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const newcomer = await createUser({ email: `newcomer@${domain}` });
    // Pending: the DNS challenge has not been answered, so nobody joins.
    expect(
      await joinVerifiedDomainWorkspaces({ userId: newcomer.id, email: newcomer.email }),
    ).toEqual([]);

    const verified = await verifyDomainClaim({
      workspaceId: workspace.id,
      lookupTxt: async () => [[saved.claim.verificationToken]],
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claim.status).toBe("verified");

    expect(
      await joinVerifiedDomainWorkspaces({ userId: newcomer.id, email: newcomer.email }),
    ).toEqual([workspace.slug]);
    expect(
      await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace.id),
            eq(workspaceMembers.userId, newcomer.id),
          ),
        ),
    ).toEqual([{ role: "editor" }]);

    // Idempotent: a second call adds nobody twice.
    expect(
      await joinVerifiedDomainWorkspaces({ userId: newcomer.id, email: newcomer.email }),
    ).toEqual([]);
  });

  isolatedTest("skips the join when the paid seat allowance is used up", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    // The free plan allows three paid seats: the owner plus two editors fills it.
    await createMember(workspace.id, { role: "editor" });
    await createMember(workspace.id, { role: "editor" });

    const domain = `${uniqueLabel("full")}.test`;
    const saved = await saveDomainClaim({
      workspaceId: workspace.id,
      domain,
      role: "editor",
      createdBy: owner.id,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await verifyDomainClaim({
      workspaceId: workspace.id,
      lookupTxt: async () => [[saved.claim.verificationToken]],
    });

    const newcomer = await createUser({ email: `newcomer@${domain}` });
    expect(
      await joinVerifiedDomainWorkspaces({ userId: newcomer.id, email: newcomer.email }),
    ).toEqual([]);
  });

  isolatedTest("a real sign-up joins a verified domain through the auth hook", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });
    const domain = `${uniqueLabel("signup")}.test`;
    const saved = await saveDomainClaim({
      workspaceId: workspace.id,
      domain,
      role: "viewer",
      createdBy: owner.id,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await verifyDomainClaim({
      workspaceId: workspace.id,
      lookupTxt: async () => [[saved.claim.verificationToken]],
    });

    const email = `newcomer-${uniqueLabel("person")}@${domain}`;
    await getAuth().api.signUpEmail({
      body: { email, password: "correct horse battery", name: "New Person" },
    });

    const joined = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(user, eq(workspaceMembers.userId, user.id))
      .where(eq(user.email, email));
    expect(joined).toEqual([{ role: "viewer" }]);
  });

  isolatedTest("refuses a domain another workspace already claimed", async () => {
    const first = await createWorkspace();
    const { user: firstOwner } = await createMember(first.id, { role: "owner" });
    const second = await createWorkspace();
    const { user: secondOwner } = await createMember(second.id, { role: "owner" });
    const domain = `${uniqueLabel("taken")}.test`;

    expect(
      (await saveDomainClaim({
        workspaceId: first.id,
        domain,
        role: "editor",
        createdBy: firstOwner.id,
      })).ok,
    ).toBe(true);

    const conflict = await saveDomainClaim({
      workspaceId: second.id,
      domain,
      role: "editor",
      createdBy: secondOwner.id,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error).toContain("already claimed");
  });
});

describe("audit metadata", () => {
  isolatedTest("returns the recorded detail for a role change", async () => {
    const workspace = await createWorkspace();
    const { user: owner } = await createMember(workspace.id, { role: "owner" });

    await recordWorkspaceAudit({
      workspaceId: workspace.id,
      actorUserId: owner.id,
      action: "member.role_changed",
      targetType: "member",
      targetId: "member-id",
      metadata: { role: "admin", previousRole: "editor", memberEmail: "person@example.test" },
    });

    const events = await listWorkspaceAuditEvents(workspace.id);
    expect(events[0]?.metadata).toEqual({
      role: "admin",
      previousRole: "editor",
      memberEmail: "person@example.test",
    });
  });
});
