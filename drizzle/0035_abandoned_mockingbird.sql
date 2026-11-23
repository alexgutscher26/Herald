CREATE TABLE "workspace_email_identities" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"postal_address" text NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "release_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_email_identities" ADD CONSTRAINT "workspace_email_identities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_email_identities" ADD CONSTRAINT "workspace_email_identities_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_email_identities" ADD CONSTRAINT "workspace_email_identities_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "winback_campaigns_release_idx" ON "winback_campaigns" USING btree ("release_id");--> statement-breakpoint
ALTER TABLE "customer_cancellations" ADD CONSTRAINT "customer_cancellations_account_cancelled_unique" UNIQUE("customer_account_id","cancelled_at");