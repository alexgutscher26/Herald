CREATE TYPE "public"."workspace_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"claimed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"retrying" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" "workspace_plan" DEFAULT 'free' NOT NULL;--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "jobs_status_completed_idx" ON "jobs" USING btree ("status","completed_at");