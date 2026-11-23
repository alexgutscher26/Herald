import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { customerSessions, customers } from "@/db/schema";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
  identifyCustomer,
  revokeCustomerSession,
} from "@/features/customer-session/session";

import { createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Customer sessions are the public write identity, so the lifecycle is tested
 * against Postgres: hashed storage, token rotation on identify, the conflict
 * rule for an address owned by someone else, and revocation.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("guest sessions", () => {
  isolatedTest("stores only a token hash and rejects a tampered cookie", async () => {
    const workspace = await createWorkspace();
    const created = await createGuestCustomerSession(workspace.id);

    expect(created.active.session.guest).toBe(true);
    expect(created.active.customer.email).toBeNull();

    const found = await findActiveCustomerSession(created.cookieValue);
    expect(found?.session.id).toBe(created.active.session.id);

    expect(await findActiveCustomerSession(`${created.cookieValue}x`)).toBeNull();
    expect(await findActiveCustomerSession(null)).toBeNull();

    const rows = await db
      .select()
      .from(customerSessions)
      .where(eq(customerSessions.id, created.active.session.id));
    expect(rows[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]?.guest).toBe(true);
  });

  isolatedTest("identify attaches the email and rotates the token", async () => {
    const workspace = await createWorkspace();
    const created = await createGuestCustomerSession(workspace.id);

    const identified = await identifyCustomer(created.active, {
      email: "  Person@Example.COM ",
      name: "  Ada  ",
    });
    expect(identified.ok).toBe(true);
    if (!identified.ok) return;

    expect(identified.active.session.guest).toBe(false);
    expect(identified.active.customer.email).toBe("Person@Example.COM");
    expect(identified.cookieValue).not.toBe(created.cookieValue);

    // The guest token is dead after the privilege change.
    expect(await findActiveCustomerSession(created.cookieValue)).toBeNull();
    const found = await findActiveCustomerSession(identified.cookieValue);
    expect(found?.customer.id).toBe(created.active.customer.id);
    expect(found?.customer.name).toBe("Ada");

    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, created.active.customer.id));
    expect(rows[0]?.email).toBe("Person@Example.COM");
    expect(rows[0]?.emailNormalized).toBe("person@example.com");
  });

  isolatedTest("refuses an address owned by another customer", async () => {
    const workspace = await createWorkspace();
    const first = await createGuestCustomerSession(workspace.id);
    const second = await createGuestCustomerSession(workspace.id);

    const identified = await identifyCustomer(first.active, {
      email: "shared@example.com",
    });
    expect(identified.ok).toBe(true);

    const conflict = await identifyCustomer(second.active, {
      email: "SHARED@example.com",
    });
    expect(conflict).toEqual({ ok: false, reason: "conflict" });

    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, second.active.customer.id));
    expect(rows[0]?.email).toBeNull();
  });
});

describe("revocation and bans", () => {
  isolatedTest("logout deletes the session row", async () => {
    const workspace = await createWorkspace();
    const created = await createGuestCustomerSession(workspace.id);

    await revokeCustomerSession(created.active.session.id);

    expect(await findActiveCustomerSession(created.cookieValue)).toBeNull();
    const rows = await db
      .select()
      .from(customerSessions)
      .where(eq(customerSessions.id, created.active.session.id));
    expect(rows).toHaveLength(0);
  });

  isolatedTest("a banned customer cannot resolve an existing session", async () => {
    const workspace = await createWorkspace();
    const created = await createGuestCustomerSession(workspace.id);

    await db
      .update(customers)
      .set({ bannedAt: new Date() })
      .where(eq(customers.id, created.active.customer.id));

    expect(await findActiveCustomerSession(created.cookieValue)).toBeNull();
  });
});
