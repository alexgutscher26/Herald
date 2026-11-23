ALTER TYPE "public"."job_type" ADD VALUE 'expire_dunning' BEFORE 'send_onboarding_emails';--> statement-breakpoint
CREATE TABLE "billing_churn_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"kind" text DEFAULT 'cancellation' NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"contact_consent" boolean DEFAULT false NOT NULL,
	"winback_sent_at" timestamp with time zone,
	"recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "event_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "billing_interval" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "dunning_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "dunning_grace_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "last_stripe_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_churn_feedback" ADD CONSTRAINT "billing_churn_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_churn_feedback" ADD CONSTRAINT "billing_churn_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_churn_feedback_workspace_created_idx" ON "billing_churn_feedback" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_churn_feedback_workspace_recovered_idx" ON "billing_churn_feedback" USING btree ("workspace_id","recovered_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_workspace_sent_idx" ON "notification_deliveries" USING btree ("workspace_id","status","sent_at");