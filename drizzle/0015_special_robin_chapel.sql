CREATE TYPE "public"."release_revision_action" AS ENUM('autosave', 'save', 'publish', 'schedule', 'archive', 'restore');--> statement-breakpoint
CREATE TABLE "release_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"action" "release_revision_action" NOT NULL,
	"status" "release_status" NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"category" "release_category" NOT NULL,
	"cover" jsonb NOT NULL,
	"youtube_url" text,
	"channels" jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_feedback_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_cancellation_reason_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_revisions" ADD CONSTRAINT "release_revisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_revisions" ADD CONSTRAINT "release_revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_revisions" ADD CONSTRAINT "release_revisions_release_fk" FOREIGN KEY ("release_id","product_id") REFERENCES "public"."releases"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_revisions_release_created_idx" ON "release_revisions" USING btree ("release_id","created_at");--> statement-breakpoint
CREATE INDEX "release_revisions_product_idx" ON "release_revisions" USING btree ("product_id");