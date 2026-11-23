CREATE TYPE "public"."digest_frequency" AS ENUM('off', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."email_verification_purpose" AS ENUM('from', 'reply_to');--> statement-breakpoint
ALTER TYPE "public"."notification_template" ADD VALUE 'daily_digest' BEFORE 'outbound_message';--> statement-breakpoint
CREATE TABLE "email_identity_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purpose" "email_verification_purpose" NOT NULL,
	"address" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_identity_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "digest_frequency" "digest_frequency" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_email_identities" ADD COLUMN "from_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_email_identities" ADD COLUMN "reply_to_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_identity_verifications" ADD CONSTRAINT "email_identity_verifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_identity_verifications_workspace_purpose_idx" ON "email_identity_verifications" USING btree ("workspace_id","purpose");--> statement-breakpoint
UPDATE "subscribers" SET "digest_frequency" = 'weekly' WHERE "weekly_digest" = true;