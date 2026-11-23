import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;

/**
 * Company-level signup funnel.
 *
 * This is deliberately separate from workspace analytics: a visitor reaches
 * these stages before a workspace exists, so there is no tenant to attach the
 * event to. Events carry no email, name, IP address, user agent or raw account
 * id. Milestone rows use a one-way keyed-by-stage hash of the subject id only
 * to make each stage count a subject once; views use a day-scoped visitor hash
 * so a reload does not become a second view.
 */
export const SIGNUP_FUNNEL_STAGES = [
  "sign_up_view",
  "account_created",
  "workspace_created",
  "first_release",
  "widget_installed",
] as const;

export type SignupFunnelStage = (typeof SIGNUP_FUNNEL_STAGES)[number];

export const signupFunnelStageEnum = pgEnum(
  "signup_funnel_stage",
  SIGNUP_FUNNEL_STAGES,
);

export const signupFunnelEvents = pgTable(
  "signup_funnel_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stage: signupFunnelStageEnum("stage").notNull(),
    /** SHA-256 of stage + subject id, or a day-scoped visitor hash for views. */
    subjectHash: text("subject_hash"),
    occurredAt: timestamp("occurred_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("signup_funnel_events_stage_time_idx").on(t.stage, t.occurredAt),
    uniqueIndex("signup_funnel_events_stage_subject_unique")
      .on(t.stage, t.subjectHash)
      .where(sql`${t.subjectHash} is not null`),
  ],
);

export type SignupFunnelEvent = typeof signupFunnelEvents.$inferSelect;
export type NewSignupFunnelEvent = typeof signupFunnelEvents.$inferInsert;
