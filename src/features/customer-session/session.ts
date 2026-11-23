import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { customerSessions, customers } from "@/db/schema";
import { isUniqueViolation } from "@/lib/error-message";
import { normalizeEmail } from "@/lib/email";

import { CUSTOMER_SESSION_TTL_MS } from "./config";
import { getCustomerSessionSecret } from "./secret";
import {
  createSessionToken,
  hashSessionToken,
  signSessionToken,
  verifySessionCookie,
} from "./token";

/**
 * Customer session operations.
 *
 * Only hashes of tokens are stored. `identify` rotates the token (a privilege
 * change must not keep a guest token valid). An email that already belongs to
 * another customer is rejected rather than linked: without email verification,
 * matching an address must never hand over an existing identity. The magic-link
 * flow can merge verified addresses later.
 */

export type ActiveCustomerSession = {
  session: {
    id: string;
    workspaceId: string;
    customerId: string;
    guest: boolean;
    expiresAt: Date;
  };
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    verifiedAt: Date | null;
    bannedAt: Date | null;
  };
};

export type CustomerSessionView = {
  workspaceId: string;
  guest: boolean;
  expiresAt: string;
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    verified: boolean;
  };
};

export function toCustomerSessionView(active: ActiveCustomerSession): CustomerSessionView {
  return {
    workspaceId: active.session.workspaceId,
    guest: active.session.guest,
    expiresAt: active.session.expiresAt.toISOString(),
    customer: {
      id: active.customer.id,
      name: active.customer.name,
      email: active.customer.email,
      verified: active.customer.verifiedAt !== null,
    },
  };
}

export async function findActiveCustomerSession(
  cookieValue: string | null,
): Promise<ActiveCustomerSession | null> {
  if (!cookieValue) return null;

  const token = verifySessionCookie(cookieValue, getCustomerSessionSecret());
  if (!token) return null;

  const rows = await db
    .select({
      session: {
        id: customerSessions.id,
        workspaceId: customerSessions.workspaceId,
        customerId: customerSessions.customerId,
        guest: customerSessions.guest,
        expiresAt: customerSessions.expiresAt,
      },
      customer: {
        id: customers.id,
        name: customers.name,
        email: customers.email,
        verifiedAt: customers.verifiedAt,
        bannedAt: customers.bannedAt,
      },
    })
    .from(customerSessions)
    .innerJoin(customers, eq(customerSessions.customerId, customers.id))
    .where(
      and(
        eq(customerSessions.tokenHash, hashSessionToken(token)),
        gt(customerSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.customer.bannedAt !== null) return null;
  return row;
}

export async function createGuestCustomerSession(workspaceId: string): Promise<{
  active: ActiveCustomerSession;
  cookieValue: string;
}> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);

  const created = await db.transaction(async (tx) => {
    const insertedCustomers = await tx
      .insert(customers)
      .values({ workspaceId })
      .returning({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        verifiedAt: customers.verifiedAt,
        bannedAt: customers.bannedAt,
      });

    const customer = insertedCustomers[0];
    if (!customer) throw new Error("Customer insert returned no row.");

    const insertedSessions = await tx
      .insert(customerSessions)
      .values({
        workspaceId,
        customerId: customer.id,
        tokenHash: token.tokenHash,
        guest: true,
        expiresAt,
      })
      .returning({
        id: customerSessions.id,
        workspaceId: customerSessions.workspaceId,
        customerId: customerSessions.customerId,
        guest: customerSessions.guest,
        expiresAt: customerSessions.expiresAt,
      });

    const session = insertedSessions[0];
    if (!session) throw new Error("Customer session insert returned no row.");

    return { session, customer };
  });

  return {
    active: created,
    cookieValue: signSessionToken(token.token, getCustomerSessionSecret()),
  };
}

export type IdentifyCustomerResult =
  | { ok: true; active: ActiveCustomerSession; cookieValue: string }
  | { ok: false; reason: "banned" | "conflict" };

export async function identifyCustomer(
  active: ActiveCustomerSession,
  input: { email: string; name?: string | undefined },
): Promise<IdentifyCustomerResult> {
  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  const name = input.name?.trim() || null;
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({
          id: customers.id,
          name: customers.name,
          email: customers.email,
          verifiedAt: customers.verifiedAt,
          bannedAt: customers.bannedAt,
        })
        .from(customers)
        .where(
          and(
            eq(customers.workspaceId, active.session.workspaceId),
            eq(customers.emailNormalized, emailNormalized),
          ),
        )
        .limit(1);

      const existing = existingRows[0];
      if (existing?.bannedAt) return { ok: false as const, reason: "banned" as const };

      // Never take over another customer's identity on an unverified address.
      if (existing && existing.id !== active.customer.id) {
        return { ok: false as const, reason: "conflict" as const };
      }

      const targetName = name ?? active.customer.name;
      await tx
        .update(customers)
        .set({ email, emailNormalized, name: targetName, updatedAt: now })
        .where(eq(customers.id, active.customer.id));

      // Rotate on privilege change: the guest token must not survive identify.
      const rotated = createSessionToken();
      const expiresAt = new Date(now.getTime() + CUSTOMER_SESSION_TTL_MS);
      const updatedSessions = await tx
        .update(customerSessions)
        .set({
          guest: false,
          tokenHash: rotated.tokenHash,
          expiresAt,
        })
        .where(eq(customerSessions.id, active.session.id))
        .returning({
          id: customerSessions.id,
          workspaceId: customerSessions.workspaceId,
          customerId: customerSessions.customerId,
          guest: customerSessions.guest,
          expiresAt: customerSessions.expiresAt,
        });

      const session = updatedSessions[0];
      if (!session) throw new Error("Customer session update returned no row.");

      return {
        ok: true as const,
        active: {
          session,
          customer: {
            id: active.customer.id,
            name: targetName,
            email,
            verifiedAt: active.customer.verifiedAt,
            bannedAt: null,
          },
        },
        cookieValue: signSessionToken(rotated.token, getCustomerSessionSecret()),
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict" };
    throw error;
  }
}

export async function revokeCustomerSession(sessionId: string): Promise<void> {
  await db.delete(customerSessions).where(eq(customerSessions.id, sessionId));
}

/**
 * Start an identified session for an existing customer.
 *
 * A banned customer gets no session; callers treat that as a refusal rather
 * than creating an anonymous identity under the same request.
 */
export async function createCustomerSession(input: {
  workspaceId: string;
  customerId: string;
}): Promise<{ active: ActiveCustomerSession; cookieValue: string } | null> {
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      verifiedAt: customers.verifiedAt,
      bannedAt: customers.bannedAt,
    })
    .from(customers)
    .where(
      and(
        eq(customers.id, input.customerId),
        eq(customers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const customer = rows[0];
  if (!customer || customer.bannedAt !== null) return null;

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);

  const inserted = await db
    .insert(customerSessions)
    .values({
      workspaceId: input.workspaceId,
      customerId: customer.id,
      tokenHash: token.tokenHash,
      guest: false,
      expiresAt,
    })
    .returning({
      id: customerSessions.id,
      workspaceId: customerSessions.workspaceId,
      customerId: customerSessions.customerId,
      guest: customerSessions.guest,
      expiresAt: customerSessions.expiresAt,
    });

  const session = inserted[0];
  if (!session) throw new Error("Customer session insert returned no row.");

  return {
    active: { session, customer },
    cookieValue: signSessionToken(token.token, getCustomerSessionSecret()),
  };
}

/**
 * Attach a verified address to a guest customer in place.
 *
 * Reusing the guest row keeps that visitor's votes, comments and requests
 * attached to the person who signed in, instead of creating a second identity
 * with an empty history.
 */
export async function verifyGuestCustomerEmail(input: {
  customerId: string;
  email: string;
  name: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .update(customers)
    .set({
      email: input.email,
      emailNormalized: normalizeEmail(input.email),
      name: input.name ?? undefined,
      verifiedAt: now,
      updatedAt: now,
    })
    .where(eq(customers.id, input.customerId));

  await db
    .update(customerSessions)
    .set({ guest: false })
    .where(eq(customerSessions.customerId, input.customerId));
}

/**
 * Move a guest's engagement onto the customer who just signed in.
 *
 * Inserts are conflict-safe because the target may already have voted on the
 * same request; the guest's duplicate is then discarded. The guest customer row
 * is deleted last, which also removes its sessions — the cookie that pointed at
 * it must not survive the merge.
 */
export async function mergeGuestCustomer(input: {
  guestCustomerId: string;
  targetCustomerId: string;
  workspaceId: string;
}): Promise<void> {
  const { guestCustomerId, targetCustomerId, workspaceId } = input;
  if (guestCustomerId === targetCustomerId) return;

  const guestRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, guestCustomerId),
        eq(customers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!guestRows[0]) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO feedback_customer_votes (feedback_post_id, customer_id)
      SELECT feedback_post_id, ${targetCustomerId}::uuid
      FROM feedback_customer_votes
      WHERE customer_id = ${guestCustomerId}::uuid
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`
      DELETE FROM feedback_customer_votes
      WHERE customer_id = ${guestCustomerId}::uuid
    `);

    await tx.execute(sql`
      INSERT INTO feedback_followers (feedback_post_id, customer_id, source)
      SELECT feedback_post_id, ${targetCustomerId}::uuid, source
      FROM feedback_followers
      WHERE customer_id = ${guestCustomerId}::uuid
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`
      DELETE FROM feedback_followers
      WHERE customer_id = ${guestCustomerId}::uuid
    `);

    await tx.execute(sql`
      INSERT INTO feedback_reactions (
        feedback_post_id, feedback_comment_id, customer_id, kind
      )
      SELECT feedback_post_id, feedback_comment_id, ${targetCustomerId}::uuid, kind
      FROM feedback_reactions
      WHERE customer_id = ${guestCustomerId}::uuid
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`
      DELETE FROM feedback_reactions
      WHERE customer_id = ${guestCustomerId}::uuid
    `);

    await tx.execute(sql`
      UPDATE feedback_posts
      SET author_customer_id = ${targetCustomerId}::uuid
      WHERE author_customer_id = ${guestCustomerId}::uuid
    `);
    await tx.execute(sql`
      UPDATE feedback_comments
      SET author_customer_id = ${targetCustomerId}::uuid
      WHERE author_customer_id = ${guestCustomerId}::uuid
    `);
    await tx.execute(sql`
      UPDATE feedback_attachments
      SET uploaded_by_customer_id = ${targetCustomerId}::uuid
      WHERE uploaded_by_customer_id = ${guestCustomerId}::uuid
    `);

    await tx.delete(customers).where(eq(customers.id, guestCustomerId));
  });
}
