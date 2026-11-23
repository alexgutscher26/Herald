import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

const tz = { withTimezone: true } as const;

export const ONBOARDING_EMAIL_KINDS = [
  "welcome",
  "first_board",
  "first_release",
  "widget_installed",
] as const;

export type OnboardingEmailKind = (typeof ONBOARDING_EMAIL_KINDS)[number];

export const onboardingEmailKindEnum = pgEnum(
  "onboarding_email_kind",
  ONBOARDING_EMAIL_KINDS,
);

export const ONBOARDING_EMAIL_STATUSES = [
  "pending",
  "sent",
  "skipped",
  "failed",
] as const;

export type OnboardingEmailStatus =
  (typeof ONBOARDING_EMAIL_STATUSES)[number];

export const onboardingEmailStatusEnum = pgEnum(
  "onboarding_email_status",
  ONBOARDING_EMAIL_STATUSES,
);

/**
 * Delivery ledger for the account onboarding sequence.
 *
 * One row per account and step makes a repeated sweep idempotent, even when a
 * provider retry overlaps the next cron invocation. `skipped` is a deliberate
 * terminal state (preference off, missing milestone); `failed` stays eligible
 * for a later attempt. The row stores no message body, token or recipient.
 */
export const onboardingEmailSends = pgTable(
  "onboarding_email_sends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: onboardingEmailKindEnum("kind").notNull(),
    status: onboardingEmailStatusEnum("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("onboarding_email_sends_user_kind_unique").on(t.userId, t.kind),
    index("onboarding_email_sends_user_idx").on(t.userId),
    index("onboarding_email_sends_status_idx").on(t.status),
  ],
);

export type OnboardingEmailSend = typeof onboardingEmailSends.$inferSelect;
export type NewOnboardingEmailSend = typeof onboardingEmailSends.$inferInsert;
