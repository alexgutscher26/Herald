import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { releases } from "@/db/schema/releases";
import { segments } from "@/db/schema/segments";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const customerProviderEnum = pgEnum("customer_provider", [
  "manual",
  "api",
  "import",
  "stripe",
]);

export const customerStatusEnum = pgEnum("customer_status", [
  "active",
  "cancelled",
  "reactivated",
  "unknown",
]);

/**
 * Win-back eligibility is an explicit, separately stored fact.
 * `unknown` is the default and must NEVER be treated as permission to send.
 */
export const winbackEligibilityEnum = pgEnum("winback_eligibility", [
  "unknown",
  "eligible",
  "ineligible",
]);

export const cancellationReasons = pgTable(
  "cancellation_reasons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("cancellation_reasons_workspace_position_idx").on(t.workspaceId, t.position),
  ],
);

/**
 * A customer of a single product, identified by an identifier that comes from
 * an external system (Stripe customer id, CRM id, ...).
 */
export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    provider: customerProviderEnum("provider").notNull().default("manual"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    name: text("name"),
    status: customerStatusEnum("status").notNull().default("unknown"),
    winbackEligibility: winbackEligibilityEnum("winback_eligibility")
      .notNull()
      .default("unknown"),
    winbackOptedOutAt: timestamp("winback_opted_out_at", tz),
    lastSeenAt: timestamp("last_seen_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // External ids are only required to be unique within their product/provider scope.
    unique("customer_accounts_product_provider_external_unique").on(
      t.productId,
      t.provider,
      t.externalId,
    ),
    index("customer_accounts_product_email_idx").on(t.productId, t.emailNormalized),
    index("customer_accounts_product_status_idx").on(t.productId, t.status),
    index("customer_accounts_product_eligibility_idx").on(t.productId, t.winbackEligibility),
  ],
);

export const customerCancellations = pgTable(
  "customer_cancellations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerAccountId: uuid("customer_account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    /** Workspace-scoped reason; application logic checks it matches the product's workspace. */
    cancellationReasonId: uuid("cancellation_reason_id").references(
      () => cancellationReasons.id,
      { onDelete: "set null" },
    ),
    cancelledAt: timestamp("cancelled_at", tz).notNull().defaultNow(),
    feedback: text("feedback"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("customer_cancellations_account_cancelled_unique").on(
      t.customerAccountId,
      t.cancelledAt,
    ),
    index("customer_cancellations_account_idx").on(t.customerAccountId),
    index("customer_cancellations_reason_idx").on(t.cancellationReasonId),
    index("customer_cancellations_cancelled_at_idx").on(t.cancelledAt),
  ],
);

/** Which cancellation reasons a release is intended to address. */
export const releaseReasonLinks = pgTable(
  "release_reason_links",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    cancellationReasonId: uuid("cancellation_reason_id")
      .notNull()
      .references(() => cancellationReasons.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "release_reason_links_pk",
      columns: [t.releaseId, t.cancellationReasonId],
    }),
    index("release_reason_links_reason_idx").on(t.cancellationReasonId),
  ],
);

export const campaignApprovalStatusEnum = pgEnum("campaign_approval_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
]);

export const campaignSendStatusEnum = pgEnum("campaign_send_status", [
  "not_sent",
  "sending",
  "paused",
  "sent",
  "partially_sent",
  "failed",
]);

/**
 * Approval and sending are independent states: a campaign can be approved and
 * still not sent, and a draft can never be sent no matter what its send status
 * says. Sending requires `approval_status = 'approved'`.
 */
export const winbackCampaigns = pgTable(
  "winback_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** The shipped release this campaign points people back to. */
    releaseId: uuid("release_id").references(() => releases.id, {
      onDelete: "set null",
    }),
    /** Optional saved segment that narrows the cancelled-customer audience. */
    segmentId: uuid("segment_id").references(() => segments.id, {
      onDelete: "set null",
    }),
    approvalStatus: campaignApprovalStatusEnum("approval_status")
      .notNull()
      .default("draft"),
    sendStatus: campaignSendStatusEnum("send_status").notNull().default("not_sent"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", tz),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at", tz),
    /** First canary batch; the remaining audience is unlocked only after it settles. */
    canarySentAt: timestamp("canary_sent_at", tz),
    canaryRecipientCount: integer("canary_recipient_count").notNull().default(0),
    /** Irreversible stop for the remaining recipients of this campaign. */
    stoppedAt: timestamp("stopped_at", tz),
    stoppedBy: text("stopped_by").references(() => user.id, { onDelete: "set null" }),
    /** Reversible hold; pending deliveries stay queued and are deferred. */
    pausedAt: timestamp("paused_at", tz),
    pausedBy: text("paused_by").references(() => user.id, { onDelete: "set null" }),
    /** Optional second body used by an A/B test. */
    messageB: text("message_b"),
    /** Percentage of the audience included in the A/B slice; 0 turns it off. */
    abTestPercent: smallint("ab_test_percent").notNull().default(0),
    sentAt: timestamp("sent_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // Composite FK: the product must belong to the workspace named on the row.
    foreignKey({
      name: "winback_campaigns_product_workspace_fk",
      columns: [t.productId, t.workspaceId],
      foreignColumns: [products.id, products.workspaceId],
    }).onDelete("cascade"),
    index("winback_campaigns_workspace_idx").on(t.workspaceId),
    index("winback_campaigns_product_send_status_idx").on(t.productId, t.sendStatus),
    index("winback_campaigns_release_idx").on(t.releaseId),
    check(
      "winback_campaigns_ab_percent_ck",
      sql`${t.abTestPercent} >= 0 AND ${t.abTestPercent} <= 100`,
    ),
    check(
      "winback_campaigns_message_b_ck",
      sql`${t.abTestPercent} = 0 OR ${t.messageB} IS NOT NULL`,
    ),
  ],
);

export const winbackRecipientStatusEnum = pgEnum("winback_recipient_status", [
  "pending",
  "excluded",
  "queued",
  "sent",
  "bounced",
  "failed",
]);

export const winbackExclusionReasonEnum = pgEnum("winback_exclusion_reason", [
  "no_email",
  "ineligible",
  "unsubscribed",
  "winback_opted_out",
  "already_received",
  "segment_mismatch",
  "campaign_not_approved",
  "campaign_stopped",
]);

/**
 * `attribution_basis` records how a re-conversion was attributed:
 * `inferred` means "followed the campaign", never "was caused by it".
 * Only `confirmed` may be presented as evidence of campaign effectiveness.
 */
export const attributionBasisEnum = pgEnum("attribution_basis", [
  "none",
  "inferred",
  "confirmed",
]);

export const winbackVariantEnum = pgEnum("winback_variant", ["a", "b"]);

export const winbackCampaignRecipients = pgTable(
  "winback_campaign_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => winbackCampaigns.id, { onDelete: "cascade" }),
    customerAccountId: uuid("customer_account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    /** Snapshot taken when the recipient set was built; `null` when the customer has no email. */
    email: text("email"),
    emailNormalized: text("email_normalized"),
    status: winbackRecipientStatusEnum("status").notNull().default("pending"),
    /** A/B assignment recorded at audience build time. */
    variant: winbackVariantEnum("variant").notNull().default("a"),
    /** Populated whenever `status = 'excluded'`; never silently blank. */
    exclusionReason: winbackExclusionReasonEnum("exclusion_reason"),
    sendAttempts: integer("send_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", tz),
    queuedAt: timestamp("queued_at", tz),
    sentAt: timestamp("sent_at", tz),
    providerMessageId: text("provider_message_id"),
    attributionBasis: attributionBasisEnum("attribution_basis").notNull().default("none"),
    convertedAt: timestamp("converted_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // Delivery de-duplication: a customer can appear in a campaign exactly once.
    unique("winback_recipients_campaign_customer_unique").on(t.campaignId, t.customerAccountId),
    index("winback_recipients_campaign_status_idx").on(t.campaignId, t.status),
    index("winback_recipients_customer_idx").on(t.customerAccountId),
    index("winback_recipients_message_id_idx").on(t.providerMessageId),
  ],
);

export const winbackSuggestionStatusEnum = pgEnum("winback_suggestion_status", [
  "pending",
  "dismissed",
]);

/**
 * A prompt created when a release that answers a cancellation reason is
 * published. It is a suggestion only: nothing is queued, approved or sent
 * until a person creates and approves a campaign.
 */
export const winbackSuggestions = pgTable(
  "winback_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    cancellationReasonId: uuid("cancellation_reason_id")
      .notNull()
      .references(() => cancellationReasons.id, { onDelete: "cascade" }),
    status: winbackSuggestionStatusEnum("status").notNull().default("pending"),
    dismissedAt: timestamp("dismissed_at", tz),
    dismissedBy: text("dismissed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // One suggestion per release and reason, no matter how often it publishes.
    unique("winback_suggestions_release_reason_unique").on(
      t.releaseId,
      t.cancellationReasonId,
    ),
    index("winback_suggestions_product_status_idx").on(t.productId, t.status),
  ],
);

export type CancellationReason = typeof cancellationReasons.$inferSelect;
export type NewCancellationReason = typeof cancellationReasons.$inferInsert;
export type CustomerAccount = typeof customerAccounts.$inferSelect;
export type NewCustomerAccount = typeof customerAccounts.$inferInsert;
export type CustomerCancellation = typeof customerCancellations.$inferSelect;
export type WinbackCampaign = typeof winbackCampaigns.$inferSelect;
export type NewWinbackCampaign = typeof winbackCampaigns.$inferInsert;
export type WinbackCampaignRecipient = typeof winbackCampaignRecipients.$inferSelect;
export type WinbackSuggestion = typeof winbackSuggestions.$inferSelect;
export type NewWinbackCampaignRecipient = typeof winbackCampaignRecipients.$inferInsert;