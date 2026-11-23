import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces, workspacePlanEnum } from "@/db/schema/workspaces";
import { user } from "@/db/schema/auth";

const tz = { withTimezone: true } as const;

/**
 * Billing is the source of truth for a workspace's plan.
 *
 * `workspaces.plan` remains a denormalised cache because every public query
 * already joins the workspace row. Only webhook processing writes either
 * column; a browser cannot promote itself by posting a plan id.
 *
 * `status` is the Stripe subscription status (`trialing`, `active`,
 * `past_due`, `canceled`, ...) or `free` for a workspace with no subscription.
 * Entitlements treat `trialing`, `active`, `lifetime`, and `past_due`/`unpaid`
 * while `dunning_grace_until` is still open as paid.
 */
export const workspaceSubscriptions = pgTable(
  "workspace_subscriptions",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    plan: workspacePlanEnum("plan").notNull().default("free"),
    status: text("status").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripePriceId: text("stripe_price_id"),
    /** `monthly` or `annual`; entitlements do not depend on it. */
    billingInterval: text("billing_interval").notNull().default("monthly"),
    trialEndsAt: timestamp("trial_ends_at", tz),
    currentPeriodEnd: timestamp("current_period_end", tz),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Set on the first failed invoice and not extended by later retries. */
    dunningStartedAt: timestamp("dunning_started_at", tz),
    /** Paid entitlement remains during this window; then the workspace is Free. */
    dunningGraceUntil: timestamp("dunning_grace_until", tz),
    /** The newest Stripe event applied to this subscription, for ordering. */
    lastStripeEventAt: timestamp("last_stripe_event_at", tz),
    /** Plan before the latest change; used for client expansion/contraction. */
    previousPlan: workspacePlanEnum("previous_plan"),
    planChangedAt: timestamp("plan_changed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_subscriptions_customer_idx").on(t.stripeCustomerId),
    index("workspace_subscriptions_status_idx").on(t.status),
  ],
);

/**
 * Processed Stripe event ids.
 *
 * The row is inserted in the same transaction as the subscription change. A
 * retry that arrives after a successful commit sees the primary key and is
 * acknowledged without applying the event twice; a failure rolls the marker
 * back so Stripe can retry the work.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    /** Stripe's event creation time; used to reject out-of-order deliveries. */
    eventCreatedAt: timestamp("event_created_at", tz),
    processedAt: timestamp("processed_at", tz).notNull().defaultNow(),
  },
  (t) => [index("stripe_events_processed_idx").on(t.processedAt)],
);

/**
 * Owner feedback captured before a downgrade or refund.
 *
 * A cancellation reason is useful only if it can be acted on later. The row is
 * kept after the workspace leaves, and `recoveredAt` is stamped when a later
 * paid subscription starts again. `winbackSentAt` makes the follow-up email
 * idempotent; `contactConsent` is the only permission to send it.
 */
export const billingChurnFeedback = pgTable(
  "billing_churn_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("cancellation"),
    reason: text("reason").notNull(),
    details: text("details"),
    contactConsent: boolean("contact_consent").notNull().default(false),
    winbackSentAt: timestamp("winback_sent_at", tz),
    recoveredAt: timestamp("recovered_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("billing_churn_feedback_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("billing_churn_feedback_workspace_recovered_idx").on(
      t.workspaceId,
      t.recoveredAt,
    ),
  ],
);

export type WorkspaceSubscription = typeof workspaceSubscriptions.$inferSelect;
export type NewWorkspaceSubscription = typeof workspaceSubscriptions.$inferInsert;
export type BillingChurnFeedback = typeof billingChurnFeedback.$inferSelect;
export type NewBillingChurnFeedback = typeof billingChurnFeedback.$inferInsert;
