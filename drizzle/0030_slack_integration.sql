ALTER TYPE "public"."feedback_source" ADD VALUE 'slack' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'slack_message' BEFORE 'recalculate_trending';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'slack_status_update' BEFORE 'recalculate_trending';--> statement-breakpoint
CREATE TABLE "slack_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text,
	"access_token" text NOT NULL,
	"scopes" text NOT NULL,
	"channel_id" text,
	"channel_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"installed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_integrations_product_unique" UNIQUE("product_id"),
	CONSTRAINT "slack_integrations_team_channel_unique" UNIQUE("team_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "slack_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "slack_request_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_ts" text NOT NULL,
	"confirmation_ts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_request_links_request_unique" UNIQUE("request_id"),
	CONSTRAINT "slack_request_links_message_unique" UNIQUE("team_id","channel_id","message_ts")
);
--> statement-breakpoint
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_installed_by_user_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_states" ADD CONSTRAINT "slack_oauth_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_states" ADD CONSTRAINT "slack_oauth_states_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_states" ADD CONSTRAINT "slack_oauth_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_request_links" ADD CONSTRAINT "slack_request_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_request_links" ADD CONSTRAINT "slack_request_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_request_links" ADD CONSTRAINT "slack_request_links_request_id_feedback_posts_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_integrations_event_idx" ON "slack_integrations" USING btree ("team_id","channel_id","active");--> statement-breakpoint
CREATE INDEX "slack_oauth_states_expiry_idx" ON "slack_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "slack_request_links_product_idx" ON "slack_request_links" USING btree ("product_id");