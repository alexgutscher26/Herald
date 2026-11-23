ALTER TABLE "subscribers" ADD COLUMN "quiet_hours_start" smallint;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "quiet_hours_end" smallint;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "quiet_hours_timezone" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "defer_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_deliveries_pending_defer_idx" ON "notification_deliveries" USING btree ("status","defer_until");--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_quiet_hours_ck" CHECK (("subscribers"."quiet_hours_start" IS NULL AND "subscribers"."quiet_hours_end" IS NULL AND "subscribers"."quiet_hours_timezone" IS NULL)
        OR ("subscribers"."quiet_hours_start" IS NOT NULL AND "subscribers"."quiet_hours_end" IS NOT NULL
          AND "subscribers"."quiet_hours_timezone" IS NOT NULL
          AND "subscribers"."quiet_hours_start" >= 0 AND "subscribers"."quiet_hours_start" < 1440
          AND "subscribers"."quiet_hours_end" >= 0 AND "subscribers"."quiet_hours_end" < 1440
          AND length("subscribers"."quiet_hours_timezone") BETWEEN 1 AND 64));