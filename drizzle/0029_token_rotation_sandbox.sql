ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_status_ck";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "rotated_from_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_status_ck" CHECK ("webhook_deliveries"."status" in ('pending','succeeded','failed','skipped'));