CREATE TYPE "public"."feedback_privacy" AS ENUM('public', 'author', 'company');--> statement-breakpoint
ALTER TABLE "feedback_saved_views" ALTER COLUMN "filters" SET DEFAULT '{"search":"","status":"all","category":"all","sort":"newest","customFields":{}}'::jsonb;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD COLUMN "privacy" "feedback_privacy" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "privacy" "feedback_privacy" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_customer_votes" ADD COLUMN "cast_by_user_id" text;--> statement-breakpoint
ALTER TABLE "feedback_customer_votes" ADD CONSTRAINT "feedback_customer_votes_cast_by_user_id_user_id_fk" FOREIGN KEY ("cast_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_customer_votes_cast_by_idx" ON "feedback_customer_votes" USING btree ("cast_by_user_id");