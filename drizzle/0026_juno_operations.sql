CREATE TYPE "public"."juno_feedback_kind" AS ENUM('create', 'vote', 'follow');--> statement-breakpoint
CREATE TYPE "public"."juno_feedback_status" AS ENUM('pending', 'confirmed', 'declined', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."juno_suggestion_kind" AS ENUM('tags', 'duplicates');--> statement-breakpoint
CREATE TYPE "public"."juno_suggestion_status" AS ENUM('ready', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'juno_tag_feedback' BEFORE 'deliver_webhook';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'juno_duplicate_suggestions' BEFORE 'deliver_webhook';--> statement-breakpoint
CREATE TABLE "juno_eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"question" text NOT NULL,
	"expected_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expect_handoff" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_eval_cases_question_ck" CHECK (length("juno_eval_cases"."question") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "juno_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"passed" boolean NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"answer" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_feedback_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "juno_feedback_kind" NOT NULL,
	"status" "juno_feedback_status" DEFAULT 'pending' NOT NULL,
	"query" text NOT NULL,
	"title" text,
	"body" text,
	"board_id" uuid,
	"feedback_post_id" uuid,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_feedback_actions_query_ck" CHECK (length("juno_feedback_actions"."query") between 1 and 4000),
	CONSTRAINT "juno_feedback_actions_title_ck" CHECK ("juno_feedback_actions"."title" IS NULL OR length("juno_feedback_actions"."title") between 3 and 140)
);
--> statement-breakpoint
CREATE TABLE "juno_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"kind" "juno_suggestion_kind" NOT NULL,
	"status" "juno_suggestion_status" DEFAULT 'ready' NOT NULL,
	"payload" jsonb NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "juno_answers" ADD COLUMN "handoff_reason" text;--> statement-breakpoint
ALTER TABLE "juno_answers" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "juno_eval_cases" ADD CONSTRAINT "juno_eval_cases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_eval_cases" ADD CONSTRAINT "juno_eval_cases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_eval_runs" ADD CONSTRAINT "juno_eval_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_eval_runs" ADD CONSTRAINT "juno_eval_runs_case_id_juno_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."juno_eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_feedback_actions" ADD CONSTRAINT "juno_feedback_actions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_feedback_actions" ADD CONSTRAINT "juno_feedback_actions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_feedback_actions" ADD CONSTRAINT "juno_feedback_actions_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_feedback_actions" ADD CONSTRAINT "juno_feedback_actions_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_suggestions" ADD CONSTRAINT "juno_suggestions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_suggestions" ADD CONSTRAINT "juno_suggestions_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "juno_eval_cases_product_idx" ON "juno_eval_cases" USING btree ("product_id","enabled");--> statement-breakpoint
CREATE INDEX "juno_eval_runs_product_created_idx" ON "juno_eval_runs" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "juno_eval_runs_case_created_idx" ON "juno_eval_runs" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "juno_feedback_actions_thread_idx" ON "juno_feedback_actions" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "juno_feedback_actions_product_idx" ON "juno_feedback_actions" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "juno_suggestions_product_kind_idx" ON "juno_suggestions" USING btree ("product_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "juno_suggestions_post_idx" ON "juno_suggestions" USING btree ("feedback_post_id");