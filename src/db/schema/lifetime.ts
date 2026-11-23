import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { user } from "@/db/schema/auth";
import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Founding Lifetime deal.
 *
 * A lifetime purchase is a real plan, not a subscription without a renewal
 * date. `lifetime_seats` is the oversell guard: exactly 100 pre-seeded rows,
 * reserved with `FOR UPDATE SKIP LOCKED` before Checkout is created. A deal row
 * is the durable record of one workspace's purchase; the workspace id is the
 * primary key, so a second purchase for the same workspace fails in Postgres.
 */

export const lifetimeDealStatusEnum = pgEnum("lifetime_deal_status", [
  "reserved",
  "active",
  "refunded",
  "revoked",
]);

export const lifetimeSeatStatusEnum = pgEnum("lifetime_seat_status", [
  "available",
  "reserved",
  "active",
]);

export const LIFETIME_SEAT_LIMIT = 100;
export const LIFETIME_TERMS_VERSION = "2026-11-21";
export const LIFETIME_AMOUNT_CENTS = 49_900;
export const LIFETIME_RESERVATION_MINUTES = 60;

export const lifetimeDeals = pgTable(
  "lifetime_deals",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    purchaserUserId: text("purchaser_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    seatNumber: integer("seat_number").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    amountCents: integer("amount_cents").notNull().default(LIFETIME_AMOUNT_CENTS),
    status: lifetimeDealStatusEnum("status").notNull().default("reserved"),
    reservedUntil: timestamp("reserved_until", tz),
    grantedAt: timestamp("granted_at", tz),
    refundedAt: timestamp("refunded_at", tz),
    termsVersion: text("terms_version").notNull().default(LIFETIME_TERMS_VERSION),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "lifetime_deals_seat_ck",
      sql`${t.seatNumber} >= 1 and ${t.seatNumber} <= 100`,
    ),
    uniqueIndex("lifetime_deals_active_purchaser_unique")
      .on(t.purchaserUserId)
      .where(sql`${t.status} in ('reserved', 'active')`),
    // One seat can have only one live deal. A refunded deal keeps its old seat
    // number for the audit trail, so the index is partial rather than global.
    uniqueIndex("lifetime_deals_active_seat_unique")
      .on(t.seatNumber)
      .where(sql`${t.status} in ('reserved', 'active')`),
    index("lifetime_deals_status_idx").on(t.status, t.createdAt),
  ],
);

export const lifetimeSeats = pgTable(
  "lifetime_seats",
  {
    seatNumber: integer("seat_number").primaryKey(),
    status: lifetimeSeatStatusEnum("status").notNull().default("available"),
    reservedUntil: timestamp("reserved_until", tz),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "lifetime_seats_number_ck",
      sql`${t.seatNumber} >= 1 and ${t.seatNumber} <= 100`,
    ),
    index("lifetime_seats_status_idx").on(t.status, t.seatNumber),
  ],
);

export type LifetimeDeal = typeof lifetimeDeals.$inferSelect;
export type LifetimeSeat = typeof lifetimeSeats.$inferSelect;
export type LifetimeDealStatus = LifetimeDeal["status"];
