CREATE TYPE "public"."onboarding_email_kind" AS ENUM('welcome', 'first_board', 'first_release', 'widget_installed');--> statement-breakpoint
CREATE TYPE "public"."onboarding_email_status" AS ENUM('pending', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."signup_funnel_stage" AS ENUM('sign_up_view', 'account_created', 'workspace_created', 'first_release', 'widget_installed');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'send_onboarding_emails' BEFORE 'schedule_outbound_messages';--> statement-breakpoint
CREATE TABLE "onboarding_email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "onboarding_email_kind" NOT NULL,
	"status" "onboarding_email_status" DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_email_sends_user_kind_unique" UNIQUE("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "signup_funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage" "signup_funnel_stage" NOT NULL,
	"subject_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "onboarding_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_email_sends" ADD CONSTRAINT "onboarding_email_sends_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_email_sends_user_idx" ON "onboarding_email_sends" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "onboarding_email_sends_status_idx" ON "onboarding_email_sends" USING btree ("status");--> statement-breakpoint
CREATE INDEX "signup_funnel_events_stage_time_idx" ON "signup_funnel_events" USING btree ("stage","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_funnel_events_stage_subject_unique" ON "signup_funnel_events" USING btree ("stage","subject_hash") WHERE "signup_funnel_events"."subject_hash" is not null;