ALTER TYPE "public"."notification_delivery_status" ADD VALUE 'complained' BEFORE 'skipped';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "spam_reason" text;