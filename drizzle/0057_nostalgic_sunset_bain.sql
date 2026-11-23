CREATE TABLE "workspace_domain_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"role" "workspace_role" DEFAULT 'editor' NOT NULL,
	"verification_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domain_claims_domain_unique" UNIQUE("domain"),
	CONSTRAINT "workspace_domain_claims_workspace_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_domain_claims" ADD CONSTRAINT "workspace_domain_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domain_claims" ADD CONSTRAINT "workspace_domain_claims_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_domain_claims_status_idx" ON "workspace_domain_claims" USING btree ("status");