ALTER TYPE "public"."workspace_plan" ADD VALUE 'starter' BEFORE 'pro';--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan" "workspace_plan" DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "workspace_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"role" "workspace_role" DEFAULT 'editor' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_invitations_workspace_email_unique" UNIQUE("workspace_id","email_normalized")
);
--> statement-breakpoint
CREATE TABLE "workspace_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"health_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domains_domain_unique" UNIQUE("domain"),
	CONSTRAINT "workspace_domains_workspace_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_branding" ADD COLUMN "hide_attribution" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_identity_settings" ADD COLUMN "mask_customer_identity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_events_processed_idx" ON "stripe_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "workspace_subscriptions_customer_idx" ON "workspace_subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "workspace_subscriptions_status_idx" ON "workspace_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_idx" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_invitations_expires_idx" ON "workspace_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workspace_domains_status_idx" ON "workspace_domains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workspace_domains_product_idx" ON "workspace_domains" USING btree ("product_id");