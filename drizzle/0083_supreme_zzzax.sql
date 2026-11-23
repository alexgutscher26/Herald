CREATE TABLE "mcp_oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "mcp_oauth_clients_name_ck" CHECK (length("mcp_oauth_clients"."name") between 1 and 120),
	CONSTRAINT "mcp_oauth_clients_redirect_uris_ck" CHECK (jsonb_typeof("mcp_oauth_clients"."redirect_uris") = 'array' and jsonb_array_length("mcp_oauth_clients"."redirect_uris") between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "mcp_oauth_codes_pkce_ck" CHECK (length("mcp_oauth_codes"."code_challenge") between 43 and 128)
);
--> statement-breakpoint
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_scopes_ck";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_client_id_mcp_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_expires_idx" ON "mcp_oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_client_idx" ON "mcp_oauth_codes" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scopes_ck" CHECK (jsonb_typeof("api_tokens"."scopes") = 'array' and "api_tokens"."scopes" <@ '["read","write","feedback:read","support:read","admin"]'::jsonb);