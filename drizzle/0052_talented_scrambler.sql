CREATE TYPE "public"."experience_kind" AS ENUM('tour', 'banner');--> statement-breakpoint
CREATE TYPE "public"."experience_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."outbound_channel" AS ENUM('email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."outbound_event_type" AS ENUM('queued', 'sent', 'opened', 'clicked', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."outbound_recurrence" AS ENUM('one_shot', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."outbound_status" AS ENUM('draft', 'scheduled', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."survey_kind" AS ENUM('nps', 'csat', 'custom');--> statement-breakpoint
CREATE TYPE "public"."survey_question_type" AS ENUM('rating', 'text', 'choice');--> statement-breakpoint
CREATE TYPE "public"."survey_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
ALTER TYPE "public"."in_app_notification_kind" ADD VALUE 'outbound_message';--> statement-breakpoint
ALTER TYPE "public"."notification_template" ADD VALUE 'outbound_message';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'schedule_outbound_messages';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'deliver_outbound_message';--> statement-breakpoint
CREATE TABLE "outbound_message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid,
	"type" "outbound_event_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "outbound_channel" DEFAULT 'in_app' NOT NULL,
	"status" "outbound_status" DEFAULT 'draft' NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"cta_label" text,
	"cta_url" text,
	"schedule_start" timestamp with time zone,
	"schedule_end" timestamp with time zone,
	"window_start" text DEFAULT '00:00' NOT NULL,
	"window_end" text DEFAULT '23:59' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"recurrence" "outbound_recurrence" DEFAULT 'one_shot' NOT NULL,
	"last_run_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid,
	"visitor_key" text NOT NULL,
	"score" integer,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"feedback_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "survey_kind" DEFAULT 'nps' NOT NULL,
	"status" "survey_status" DEFAULT 'draft' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suppress_days" integer DEFAULT 30 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveys_product_slug_unique" UNIQUE("product_id","slug")
);
--> statement-breakpoint
CREATE TABLE "widget_experience_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid,
	"visitor_key" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_experience_dismissals_visitor_unique" UNIQUE("experience_id","visitor_key")
);
--> statement-breakpoint
CREATE TABLE "widget_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "experience_kind" NOT NULL,
	"name" text NOT NULL,
	"status" "experience_status" DEFAULT 'draft' NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"dismiss_days" integer DEFAULT 30 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "outbound_message_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_message_events" ADD CONSTRAINT "outbound_message_events_message_id_outbound_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message_events" ADD CONSTRAINT "outbound_message_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message_events" ADD CONSTRAINT "outbound_message_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_dismissals" ADD CONSTRAINT "widget_experience_dismissals_experience_id_widget_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."widget_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_dismissals" ADD CONSTRAINT "widget_experience_dismissals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_dismissals" ADD CONSTRAINT "widget_experience_dismissals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD CONSTRAINT "widget_experiences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD CONSTRAINT "widget_experiences_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_message_events_message_idx" ON "outbound_message_events" USING btree ("message_id","type");--> statement-breakpoint
CREATE INDEX "outbound_messages_product_status_idx" ON "outbound_messages" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "survey_responses_survey_created_idx" ON "survey_responses" USING btree ("survey_id","created_at");--> statement-breakpoint
CREATE INDEX "survey_responses_visitor_idx" ON "survey_responses" USING btree ("survey_id","visitor_key");--> statement-breakpoint
CREATE INDEX "surveys_product_status_idx" ON "surveys" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "widget_experience_dismissals_workspace_idx" ON "widget_experience_dismissals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "widget_experiences_product_status_idx" ON "widget_experiences" USING btree ("product_id","status");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_outbound_idx" ON "notification_deliveries" USING btree ("outbound_message_id");