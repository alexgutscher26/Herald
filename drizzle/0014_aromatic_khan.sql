CREATE TYPE "public"."in_app_notification_kind" AS ENUM('feedback_status_changed', 'feedback_reply', 'release_published');--> statement-breakpoint
ALTER TYPE "public"."subscriber_source" ADD VALUE 'follower';--> statement-breakpoint
ALTER TYPE "public"."notification_template" ADD VALUE 'feedback_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_template" ADD VALUE 'feedback_reply';--> statement-breakpoint
ALTER TYPE "public"."notification_template" ADD VALUE 'weekly_digest';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'send_weekly_digest' BEFORE 'process_import';--> statement-breakpoint
CREATE TABLE "in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "in_app_notification_kind" NOT NULL,
	"feedback_post_id" uuid,
	"release_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "in_app_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_single_source_ck";--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "notify_status_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "notify_replies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "weekly_digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "feedback_post_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "feedback_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "recipient_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "in_app_notifications_customer_created_idx" ON "in_app_notifications" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "in_app_notifications_customer_read_idx" ON "in_app_notifications" USING btree ("customer_id","read_at");--> statement-breakpoint
CREATE INDEX "in_app_notifications_product_idx" ON "in_app_notifications" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_feedback_comment_id_feedback_comments_id_fk" FOREIGN KEY ("feedback_comment_id") REFERENCES "public"."feedback_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_customer_id_customers_id_fk" FOREIGN KEY ("recipient_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscribers_customer_idx" ON "subscribers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscribers_product_source_idx" ON "subscribers" USING btree ("product_id","source");--> statement-breakpoint
CREATE INDEX "notification_deliveries_feedback_post_idx" ON "notification_deliveries" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_customer_idx" ON "notification_deliveries" USING btree ("recipient_customer_id");