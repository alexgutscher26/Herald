-- Retire the second roadmap model. A linked feedback post remains and is now
-- the roadmap card; feedback status is authoritative, so the old roadmap
-- status is intentionally not copied over it. Roadmap rows that were never
-- linked had no customer-visible request to migrate and are dropped.
DROP TABLE "roadmap_feedback_links" CASCADE;--> statement-breakpoint
DROP TABLE "roadmap_items" CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "public_feedback_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "public_roadmap_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP TYPE "public"."roadmap_status";