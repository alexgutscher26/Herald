CREATE TYPE "public"."duplicate_review_status" AS ENUM('pending', 'merged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."agent_action_kind" AS ENUM('send_transcript');--> statement-breakpoint
CREATE TYPE "public"."agent_action_status" AS ENUM('queued', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."juno_answer_feedback" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."juno_duplicate_mode" AS ENUM('off', 'assisted', 'automatic');--> statement-breakpoint
CREATE TABLE "duplicate_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_post_id" uuid NOT NULL,
	"target_post_id" uuid NOT NULL,
	"score" real NOT NULL,
	"mode" text NOT NULL,
	"status" "duplicate_review_status" DEFAULT 'pending' NOT NULL,
	"merge_id" uuid,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_reviews_mode_ck" CHECK ("duplicate_reviews"."mode" in ('assisted', 'automatic')),
	CONSTRAINT "duplicate_reviews_score_ck" CHECK ("duplicate_reviews"."score" >= 0 AND "duplicate_reviews"."score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "agent_action_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"action" "agent_action_kind" NOT NULL,
	"status" "agent_action_status" DEFAULT 'queued' NOT NULL,
	"message_id" uuid,
	"delivery_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_action_settings" (
	"product_id" uuid NOT NULL,
	"action" "agent_action_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_action_settings_pk" PRIMARY KEY("product_id","action"),
	CONSTRAINT "agent_action_settings_review_ck" CHECK ("agent_action_settings"."enabled" = false OR "agent_action_settings"."reviewed_by" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "original_title" text;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "original_body" text;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "split_from_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "juno_answers" ADD COLUMN "retrieved_sources" jsonb;--> statement-breakpoint
ALTER TABLE "juno_answers" ADD COLUMN "feedback_rating" "juno_answer_feedback";--> statement-breakpoint
ALTER TABLE "juno_answers" ADD COLUMN "feedback_by" text;--> statement-breakpoint
ALTER TABLE "juno_answers" ADD COLUMN "feedback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "juno_settings" ADD COLUMN "duplicate_mode" "juno_duplicate_mode" DEFAULT 'assisted' NOT NULL;--> statement-breakpoint
ALTER TABLE "juno_settings" ADD COLUMN "submission_assistant_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_source_post_id_feedback_posts_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_target_post_id_feedback_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_merge_id_feedback_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."feedback_merges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_runs" ADD CONSTRAINT "agent_action_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_runs" ADD CONSTRAINT "agent_action_runs_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_settings" ADD CONSTRAINT "agent_action_settings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_settings" ADD CONSTRAINT "agent_action_settings_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_reviews_pending_unique" ON "duplicate_reviews" USING btree ("source_post_id","target_post_id") WHERE "duplicate_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "duplicate_reviews_product_status_idx" ON "duplicate_reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "duplicate_reviews_source_idx" ON "duplicate_reviews" USING btree ("source_post_id");--> statement-breakpoint
CREATE INDEX "agent_action_runs_product_created_idx" ON "agent_action_runs" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_action_runs_conversation_idx" ON "agent_action_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_split_from_id_feedback_posts_id_fk" FOREIGN KEY ("split_from_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_answers" ADD CONSTRAINT "juno_answers_feedback_by_user_id_fk" FOREIGN KEY ("feedback_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_posts_split_from_idx" ON "feedback_posts" USING btree ("split_from_id");--> statement-breakpoint
CREATE INDEX "juno_answers_product_confidence_idx" ON "juno_answers" USING btree ("product_id","confidence");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_original_pair_ck" CHECK (("feedback_posts"."original_title" IS NULL) = ("feedback_posts"."original_body" IS NULL));