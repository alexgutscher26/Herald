CREATE TYPE "public"."support_tool_provider" AS ENUM('intercom', 'zendesk');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'slack_command' BEFORE 'slack_status_update';--> statement-breakpoint
CREATE TABLE "support_tool_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"feedback_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tool_captures_external_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "support_tool_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider" "support_tool_provider" NOT NULL,
	"name" text NOT NULL,
	"board_id" uuid NOT NULL,
	"webhook_token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tool_connections_webhook_token_unique" UNIQUE("webhook_token"),
	CONSTRAINT "support_tool_connections_product_provider_unique" UNIQUE("product_id","provider")
);
--> statement-breakpoint
CREATE TABLE "github_app_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text DEFAULT 'Organization' NOT NULL,
	"repository_selection" text DEFAULT 'all' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"installed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installations_installation_id_unique" UNIQUE("installation_id"),
	CONSTRAINT "github_app_installations_product_unique" UNIQUE("product_id")
);
--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "previous_secret" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "previous_secret_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tool_captures" ADD CONSTRAINT "support_tool_captures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_captures" ADD CONSTRAINT "support_tool_captures_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_captures" ADD CONSTRAINT "support_tool_captures_connection_id_support_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."support_tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_captures" ADD CONSTRAINT "support_tool_captures_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_connections" ADD CONSTRAINT "support_tool_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_connections" ADD CONSTRAINT "support_tool_connections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_connections" ADD CONSTRAINT "support_tool_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tool_connections" ADD CONSTRAINT "support_tool_connections_board_fk" FOREIGN KEY ("board_id","product_id") REFERENCES "public"."boards"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_installed_by_user_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_tool_captures_product_idx" ON "support_tool_captures" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tool_connections_product_idx" ON "support_tool_connections" USING btree ("product_id","active");--> statement-breakpoint
CREATE INDEX "github_app_installations_workspace_idx" ON "github_app_installations" USING btree ("workspace_id","active");--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_previous_secret_ck" CHECK ("webhooks"."previous_secret" is null or length("webhooks"."previous_secret") >= 20);--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_previous_secret_expiry_ck" CHECK ("webhooks"."previous_secret" is null or "webhooks"."previous_secret_expires_at" is not null);