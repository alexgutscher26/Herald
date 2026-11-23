CREATE TYPE "public"."report_format" AS ENUM('csv', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."report_run_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_schedule" AS ENUM('none', 'daily', 'weekly', 'monthly');--> statement-breakpoint
ALTER TYPE "public"."workspace_role" ADD VALUE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'export_saved_reports' BEFORE 'purge_workspaces';--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_custom_roles_workspace_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "workspace_enterprise_identity" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" text,
	"saml_issuer" text,
	"saml_domain" text,
	"saml_enabled" boolean DEFAULT false NOT NULL,
	"enforced" boolean DEFAULT false NOT NULL,
	"configured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member_custom_roles" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"custom_role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_custom_roles_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_scim_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_scim_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" "report_run_status" NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"result" jsonb,
	"alert_triggered" boolean DEFAULT false NOT NULL,
	"emailed_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"dataset" text NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"days" integer DEFAULT 30 NOT NULL,
	"compare_previous" boolean DEFAULT true NOT NULL,
	"schedule" "report_schedule" DEFAULT 'none' NOT NULL,
	"format" "report_format" DEFAULT 'csv' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert" jsonb,
	"alert_active" boolean DEFAULT false NOT NULL,
	"show_on_dashboard" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_custom_roles" ADD CONSTRAINT "workspace_custom_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_enterprise_identity" ADD CONSTRAINT "workspace_enterprise_identity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_custom_roles" ADD CONSTRAINT "workspace_member_custom_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_custom_roles" ADD CONSTRAINT "workspace_member_custom_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_custom_roles" ADD CONSTRAINT "workspace_member_custom_roles_custom_role_id_workspace_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."workspace_custom_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_scim_tokens" ADD CONSTRAINT "workspace_scim_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_scim_tokens" ADD CONSTRAINT "workspace_scim_tokens_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_report_id_saved_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."saved_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sso_provider_domain_idx" ON "sso_provider" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "workspace_custom_roles_workspace_idx" ON "workspace_custom_roles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_enterprise_identity_enforced_idx" ON "workspace_enterprise_identity" USING btree ("enforced");--> statement-breakpoint
CREATE INDEX "workspace_member_custom_roles_role_idx" ON "workspace_member_custom_roles" USING btree ("custom_role_id");--> statement-breakpoint
CREATE INDEX "workspace_scim_tokens_workspace_idx" ON "workspace_scim_tokens" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_report_created_idx" ON "report_runs" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_workspace_created_idx" ON "report_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "saved_reports_workspace_product_idx" ON "saved_reports" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "saved_reports_schedule_idx" ON "saved_reports" USING btree ("schedule","last_run_at");--> statement-breakpoint
CREATE INDEX "saved_reports_product_dashboard_idx" ON "saved_reports" USING btree ("product_id","show_on_dashboard");