-- `deliver_webhook` and `recalculate_trending` were added to the enum without a
-- handler, so any row of those types is a dead letter that the runner could
-- only ever mark failed. Clear them first: the column cannot be cast to the
-- rebuilt type while a row still holds a value the new type no longer has.
DELETE FROM "jobs" WHERE "type"::text IN ('deliver_webhook', 'recalculate_trending');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."job_type";--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('publish_releases', 'deliver_notification', 'send_email', 'send_weekly_digest', 'process_import', 'crawl_knowledge', 'juno_answer', 'juno_auto_resolve', 'juno_tag_feedback', 'juno_duplicate_suggestions', 'slack_message', 'slack_status_update', 'slack_support_message', 'slack_support_mirror', 'issue_tracker_event', 'sync_crm_connection', 'schedule_crm_sync', 'recalculate_analytics', 'export_saved_reports', 'purge_workspaces', 'prune_audit_events', 'send_billing_email', 'schedule_outbound_messages', 'deliver_outbound_message');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "type" SET DATA TYPE "public"."job_type" USING "type"::"public"."job_type";