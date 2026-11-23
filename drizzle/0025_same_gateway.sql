CREATE TYPE "public"."juno_answer_status" AS ENUM('answered', 'handoff', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."juno_conversation_state" AS ENUM('active', 'paused', 'handed_off', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."juno_formality" AS ENUM('casual', 'neutral', 'formal');--> statement-breakpoint
CREATE TYPE "public"."juno_reply_length" AS ENUM('short', 'medium', 'long');--> statement-breakpoint
CREATE TYPE "public"."juno_tone" AS ENUM('warm', 'professional', 'direct', 'empathetic', 'playful');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_kind" AS ENUM('upload', 'url');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_status" AS ENUM('processing', 'live', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."knowledge_version_status" AS ENUM('building', 'live', 'failed', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."conversation_message_author" ADD VALUE 'juno' BEFORE 'system';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'juno_answer' BEFORE 'deliver_webhook';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'juno_auto_resolve' BEFORE 'deliver_webhook';--> statement-breakpoint
CREATE TABLE "juno_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"message_id" uuid,
	"status" "juno_answer_status" NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"confidence" real,
	"citations" jsonb,
	"model" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_conversations" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"state" "juno_conversation_state" DEFAULT 'active' NOT NULL,
	"handoff_reason" text,
	"last_juno_message_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_settings" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"tone" "juno_tone" DEFAULT 'warm' NOT NULL,
	"reply_length" "juno_reply_length" DEFAULT 'medium' NOT NULL,
	"formality" "juno_formality" DEFAULT 'neutral' NOT NULL,
	"emoji" boolean DEFAULT false NOT NULL,
	"language" text DEFAULT 'auto' NOT NULL,
	"model" text,
	"confidence_floor" real DEFAULT 0.35 NOT NULL,
	"daily_budget_cents" integer DEFAULT 100 NOT NULL,
	"auto_resolve_chat_minutes" integer DEFAULT 30 NOT NULL,
	"auto_resolve_email_minutes" integer DEFAULT 4320 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_settings_floor_ck" CHECK ("juno_settings"."confidence_floor" >= 0 AND "juno_settings"."confidence_floor" <= 1),
	CONSTRAINT "juno_settings_budget_ck" CHECK ("juno_settings"."daily_budget_cents" >= 0),
	CONSTRAINT "juno_settings_timers_ck" CHECK ("juno_settings"."auto_resolve_chat_minutes" >= 0 AND "juno_settings"."auto_resolve_email_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "juno_usage" (
	"product_id" uuid NOT NULL,
	"day" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "juno_usage_pk" PRIMARY KEY("product_id","day"),
	CONSTRAINT "juno_usage_requests_ck" CHECK ("juno_usage"."requests" >= 0),
	CONSTRAINT "juno_usage_cost_ck" CHECK ("juno_usage"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_pages_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "knowledge_source_kind" NOT NULL,
	"url" text,
	"path_prefix" text,
	"status" "knowledge_source_status" DEFAULT 'processing' NOT NULL,
	"active_version_id" uuid,
	"page_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "knowledge_sources_url_ck" CHECK (("knowledge_sources"."kind" = 'url' AND "knowledge_sources"."url" IS NOT NULL) OR ("knowledge_sources"."kind" = 'upload' AND "knowledge_sources"."url" IS NULL)),
	CONSTRAINT "knowledge_sources_name_ck" CHECK (length("knowledge_sources"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "knowledge_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" "knowledge_version_status" DEFAULT 'building' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "knowledge_versions_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_author_ck";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "citations" jsonb;--> statement-breakpoint
ALTER TABLE "juno_answers" ADD CONSTRAINT "juno_answers_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_conversations" ADD CONSTRAINT "juno_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_conversations" ADD CONSTRAINT "juno_conversations_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_settings" ADD CONSTRAINT "juno_settings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_usage" ADD CONSTRAINT "juno_usage_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_page_fk" FOREIGN KEY ("page_id","product_id") REFERENCES "public"."knowledge_pages"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_version_fk" FOREIGN KEY ("version_id","product_id") REFERENCES "public"."knowledge_versions"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_source_fk" FOREIGN KEY ("source_id","product_id") REFERENCES "public"."knowledge_sources"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "juno_answers_product_created_idx" ON "juno_answers" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "juno_conversations_state_idx" ON "juno_conversations" USING btree ("product_id","state");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_version_idx" ON "knowledge_chunks" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_product_idx" ON "knowledge_chunks" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_pages_version_idx" ON "knowledge_pages" USING btree ("version_id","ordinal");--> statement-breakpoint
CREATE INDEX "knowledge_sources_product_idx" ON "knowledge_sources" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_versions_source_idx" ON "knowledge_versions" USING btree ("source_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_ck" CHECK (("conversation_messages"."author_type" = 'team' AND "conversation_messages"."author_user_id" IS NOT NULL)
        OR ("conversation_messages"."author_type" = 'customer' AND "conversation_messages"."author_customer_id" IS NOT NULL)
        -- Compared as text: a migration cannot reference a value it adds to
        -- the enum in the same transaction.
        OR ("conversation_messages"."author_type"::text = 'juno' AND "conversation_messages"."author_user_id" IS NULL)
        OR "conversation_messages"."author_type" = 'system');