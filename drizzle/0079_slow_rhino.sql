ALTER TYPE "public"."outbound_event_type" ADD VALUE 'converted' BEFORE 'dismissed';--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "outbound_frequency_cap" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "outbound_frequency_window_days" smallint DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_outbound_frequency_cap_ck" CHECK ("workspaces"."outbound_frequency_cap" >= 0 AND "workspaces"."outbound_frequency_cap" <= 100);--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_outbound_frequency_window_ck" CHECK ("workspaces"."outbound_frequency_window_days" >= 1 AND "workspaces"."outbound_frequency_window_days" <= 365);