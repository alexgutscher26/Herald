ALTER TYPE "public"."job_type" ADD VALUE 'evaluate_alerts';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'verify_backups';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'prune_observability';--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"product_id" uuid,
	"feature" text DEFAULT 'ai' NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_events_tokens_ck" CHECK ("ai_usage_events"."prompt_tokens" >= 0 and "ai_usage_events"."completion_tokens" >= 0),
	CONSTRAINT "ai_usage_events_cost_ck" CHECK ("ai_usage_events"."estimated_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "alert_states" (
	"rule" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'ok' NOT NULL,
	"value" double precision,
	"threshold" double precision,
	"detail" text,
	"fired_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_states_state_ck" CHECK ("alert_states"."state" in ('ok','firing'))
);
--> statement-breakpoint
CREATE TABLE "backup_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"object_count" integer,
	"byte_size" bigint,
	"checksum" text,
	"manifest_key" text,
	"duration_ms" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_verifications_kind_ck" CHECK ("backup_verifications"."kind" in ('database','storage','manifest')),
	CONSTRAINT "backup_verifications_status_ck" CHECK ("backup_verifications"."status" in ('ok','failed'))
);
--> statement-breakpoint
CREATE TABLE "dashboard_view_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid,
	"surface" text NOT NULL,
	"section" text NOT NULL,
	"actor_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_view_events_surface_ck" CHECK ("dashboard_view_events"."surface" in ('workspace_settings','product_settings')),
	CONSTRAINT "dashboard_view_events_section_ck" CHECK (length("dashboard_view_events"."section") between 1 and 60 and "dashboard_view_events"."section" ~ '^[a-z0-9][a-z0-9-]*$'),
	CONSTRAINT "dashboard_view_events_actor_ck" CHECK (length("dashboard_view_events"."actor_ref") between 8 and 64)
);
--> statement-breakpoint
CREATE TABLE "request_metrics" (
	"bucket_start" timestamp with time zone NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"status_class" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"total_ms" integer DEFAULT 0 NOT NULL,
	"max_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "request_metrics_bucket_start_route_method_status_class_pk" PRIMARY KEY("bucket_start","route","method","status_class"),
	CONSTRAINT "request_metrics_status_ck" CHECK ("request_metrics"."status_class" in ('2xx','3xx','4xx','5xx')),
	CONSTRAINT "request_metrics_count_ck" CHECK ("request_metrics"."count" >= 0),
	CONSTRAINT "request_metrics_timing_ck" CHECK ("request_metrics"."total_ms" >= 0 and "request_metrics"."max_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_view_events" ADD CONSTRAINT "dashboard_view_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_view_events" ADD CONSTRAINT "dashboard_view_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_created_idx" ON "ai_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_workspace_created_idx" ON "ai_usage_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_verifications_kind_checked_idx" ON "backup_verifications" USING btree ("kind","checked_at");--> statement-breakpoint
CREATE INDEX "backup_verifications_checked_idx" ON "backup_verifications" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "dashboard_view_events_workspace_created_idx" ON "dashboard_view_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "dashboard_view_events_surface_section_idx" ON "dashboard_view_events" USING btree ("surface","section","created_at");--> statement-breakpoint
CREATE INDEX "request_metrics_bucket_idx" ON "request_metrics" USING btree ("bucket_start");