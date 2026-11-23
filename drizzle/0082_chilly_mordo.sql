ALTER TABLE "products" ADD COLUMN "public_shipped_counter_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "previous_plan" "workspace_plan";--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "plan_changed_at" timestamp with time zone;