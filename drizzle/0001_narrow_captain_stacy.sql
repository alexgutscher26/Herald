CREATE TYPE "public"."release_category" AS ENUM('feature', 'improvement', 'fix');--> statement-breakpoint
CREATE TYPE "public"."feedback_category" AS ENUM('feature_request', 'bug', 'improvement', 'question');--> statement-breakpoint
CREATE TYPE "public"."feedback_comment_author_type" AS ENUM('customer', 'team');--> statement-breakpoint
CREATE TABLE "feedback_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"author_type" "feedback_comment_author_type" DEFAULT 'team' NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "category" "release_category" DEFAULT 'feature' NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "cover" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "channel_public_changelog" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "channel_in_app_widget" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "channel_subscriber_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "author_email" text;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "author_company" text;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "category" "feedback_category" DEFAULT 'question' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_post_product_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_comments_post_created_idx" ON "feedback_comments" USING btree ("feedback_post_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_comments_product_idx" ON "feedback_comments" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_merged_into_id_feedback_posts_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_posts_merged_into_idx" ON "feedback_posts" USING btree ("merged_into_id");