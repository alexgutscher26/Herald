CREATE TABLE "customer_login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"token_hash" text NOT NULL,
	"next_path" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_identity_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"sso_enabled" boolean DEFAULT false NOT NULL,
	"sso_secret_encrypted" text,
	"sso_issuer" text,
	"sso_audience" text,
	"require_signed_tokens" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moderation_reviews" ADD COLUMN "checks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_login_tokens" ADD CONSTRAINT "customer_login_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_identity_settings" ADD CONSTRAINT "workspace_identity_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_login_tokens_workspace_email_idx" ON "customer_login_tokens" USING btree ("workspace_id","email_normalized","created_at");--> statement-breakpoint
CREATE INDEX "customer_login_tokens_expires_at_idx" ON "customer_login_tokens" USING btree ("expires_at");