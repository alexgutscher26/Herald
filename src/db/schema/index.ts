/**
 * Barrel for the Drizzle schema.
 *
 * Import order matters for migration generation: every table must be defined
 * before the tables that reference it, otherwise `drizzle-kit generate` can
 * emit a foreign key before its target exists.
 */
export * from "@/db/schema/auth";
export * from "@/db/schema/onboarding";
export * from "@/db/schema/workspaces";
export * from "@/db/schema/enterprise";
export * from "@/db/schema/widget";
export * from "@/db/schema/branding";
export * from "@/db/schema/customers";
export * from "@/db/schema/events";
export * from "@/db/schema/identity";
export * from "@/db/schema/boards";
export * from "@/db/schema/releases";
export * from "@/db/schema/imports";
export * from "@/db/schema/feedback";
export * from "@/db/schema/feedback-extensions";
export * from "@/db/schema/custom-fields";
export * from "@/db/schema/prioritisation";
export * from "@/db/schema/feedback-views";
export * from "@/db/schema/roadmap";
export * from "@/db/schema/subscribers";
export * from "@/db/schema/segments";
export * from "@/db/schema/winback";
export * from "@/db/schema/notifications";
export * from "@/db/schema/conversations";
export * from "@/db/schema/knowledge";
export * from "@/db/schema/support";
export * from "@/db/schema/jobs";
export * from "@/db/schema/email";
export * from "@/db/schema/rate-limits";
export * from "@/db/schema/api";
export * from "@/db/schema/webhooks";
export * from "@/db/schema/slack";
export * from "@/db/schema/integrations";
export * from "@/db/schema/support-tools";
export * from "@/db/schema/github";
export * from "@/db/schema/billing";
export * from "@/db/schema/lifetime";
export * from "@/db/schema/invitations";
export * from "@/db/schema/domains";
export * from "@/db/schema/domain-claims";
export * from "@/db/schema/analytics";
export * from "@/db/schema/signup-funnel";
export * from "@/db/schema/reporting";
export * from "@/db/schema/help";
export * from "@/db/schema/api-docs";
export * from "@/db/schema/data-controls";
export * from "@/db/schema/engagement";
export * from "@/db/schema/observability";