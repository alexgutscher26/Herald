ALTER TYPE "public"."winback_exclusion_reason" ADD VALUE 'campaign_stopped';--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "canary_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "canary_recipient_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "stopped_by" text;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_stopped_by_user_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;