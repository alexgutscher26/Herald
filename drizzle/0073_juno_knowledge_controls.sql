CREATE TYPE "public"."knowledge_source_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "visibility" "knowledge_source_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "recrawl_interval_hours" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "last_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "last_change_summary" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_recrawl_ck" CHECK ("knowledge_sources"."recrawl_interval_hours" >= 0 AND "knowledge_sources"."recrawl_interval_hours" <= 720);