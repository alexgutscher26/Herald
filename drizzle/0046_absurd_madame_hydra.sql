CREATE TYPE "public"."crm_provider" AS ENUM('hubspot', 'salesforce');--> statement-breakpoint
CREATE TYPE "public"."issue_link_state" AS ENUM('pending', 'linked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."issue_sync_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."issue_sync_outcome" AS ENUM('succeeded', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."issue_tracker_provider" AS ENUM('linear', 'jira', 'github', 'clickup', 'azure_devops');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'issue_tracker_event' BEFORE 'recalculate_trending';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'sync_crm_connection' BEFORE 'recalculate_trending';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'schedule_crm_sync' BEFORE 'recalculate_trending';--> statement-breakpoint
CREATE TABLE "crm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "crm_provider" NOT NULL,
	"name" text NOT NULL,
	"api_token" text NOT NULL,
	"instance_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_connections_workspace_provider_unique" UNIQUE("workspace_id","provider")
);
--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"provider" "issue_tracker_provider" NOT NULL,
	"state" "issue_link_state" DEFAULT 'pending' NOT NULL,
	"external_id" text NOT NULL,
	"external_key" text,
	"external_url" text,
	"external_status" text,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_links_post_connection_unique" UNIQUE("feedback_post_id","connection_id"),
	CONSTRAINT "issue_links_external_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "issue_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"issue_link_id" uuid,
	"feedback_post_id" uuid,
	"direction" "issue_sync_direction" NOT NULL,
	"action" text NOT NULL,
	"outcome" "issue_sync_outcome" NOT NULL,
	"dedupe_key" text NOT NULL,
	"external_id" text,
	"external_status" text,
	"from_status" text,
	"to_status" text,
	"actor_user_id" text,
	"actor_name" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_sync_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "issue_tracker_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider" "issue_tracker_provider" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"api_token" text NOT NULL,
	"webhook_secret" text,
	"webhook_token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_tracker_connections_webhook_token_unique" UNIQUE("webhook_token"),
	CONSTRAINT "issue_tracker_connections_product_provider_unique" UNIQUE("product_id","provider"),
	CONSTRAINT "issue_tracker_connections_tenant_unique" UNIQUE("id","workspace_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_provider" text;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_external_id" text;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_contact_count" integer;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_open_deal_count" integer;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_open_deal_value_cents" bigint;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_annual_revenue_cents" bigint;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_companies" ADD COLUMN "crm_sync_error" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "crm_provider" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "crm_external_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "crm_company_external_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "crm_lifecycle_stage" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "crm_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_connection_fk" FOREIGN KEY ("connection_id","workspace_id","product_id") REFERENCES "public"."issue_tracker_connections"("id","workspace_id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_feedback_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sync_events" ADD CONSTRAINT "issue_sync_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sync_events" ADD CONSTRAINT "issue_sync_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sync_events" ADD CONSTRAINT "issue_sync_events_connection_id_issue_tracker_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."issue_tracker_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sync_events" ADD CONSTRAINT "issue_sync_events_issue_link_id_issue_links_id_fk" FOREIGN KEY ("issue_link_id") REFERENCES "public"."issue_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sync_events" ADD CONSTRAINT "issue_sync_events_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sync_events" ADD CONSTRAINT "issue_sync_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tracker_connections" ADD CONSTRAINT "issue_tracker_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tracker_connections" ADD CONSTRAINT "issue_tracker_connections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tracker_connections" ADD CONSTRAINT "issue_tracker_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_connections_workspace_idx" ON "crm_connections" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE INDEX "issue_links_product_post_idx" ON "issue_links" USING btree ("product_id","feedback_post_id");--> statement-breakpoint
CREATE INDEX "issue_links_connection_external_idx" ON "issue_links" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "issue_sync_events_product_time_idx" ON "issue_sync_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_sync_events_connection_time_idx" ON "issue_sync_events" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_tracker_connections_product_idx" ON "issue_tracker_connections" USING btree ("product_id","active");