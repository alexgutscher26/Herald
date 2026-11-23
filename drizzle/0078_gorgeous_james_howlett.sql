CREATE TYPE "public"."winback_suggestion_status" AS ENUM('pending', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."winback_variant" AS ENUM('a', 'b');--> statement-breakpoint
ALTER TYPE "public"."campaign_send_status" ADD VALUE 'paused' BEFORE 'sent';--> statement-breakpoint
CREATE TABLE "winback_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"cancellation_reason_id" uuid NOT NULL,
	"status" "winback_suggestion_status" DEFAULT 'pending' NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "winback_suggestions_release_reason_unique" UNIQUE("release_id","cancellation_reason_id")
);
--> statement-breakpoint
ALTER TABLE "winback_campaign_recipients" ADD COLUMN "variant" "winback_variant" DEFAULT 'a' NOT NULL;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "paused_by" text;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "message_b" text;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "ab_test_percent" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "winback_suggestions" ADD CONSTRAINT "winback_suggestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_suggestions" ADD CONSTRAINT "winback_suggestions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_suggestions" ADD CONSTRAINT "winback_suggestions_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_suggestions" ADD CONSTRAINT "winback_suggestions_cancellation_reason_id_cancellation_reasons_id_fk" FOREIGN KEY ("cancellation_reason_id") REFERENCES "public"."cancellation_reasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_suggestions" ADD CONSTRAINT "winback_suggestions_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "winback_suggestions_product_status_idx" ON "winback_suggestions" USING btree ("product_id","status");--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_paused_by_user_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_ab_percent_ck" CHECK ("winback_campaigns"."ab_test_percent" >= 0 AND "winback_campaigns"."ab_test_percent" <= 100);--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_message_b_ck" CHECK ("winback_campaigns"."ab_test_percent" = 0 OR "winback_campaigns"."message_b" IS NOT NULL);--> statement-breakpoint
INSERT INTO "winback_suggestions" ("workspace_id", "product_id", "release_id", "cancellation_reason_id")
SELECT p."workspace_id", r."product_id", r."id", l."cancellation_reason_id"
FROM "release_reason_links" l
JOIN "releases" r ON r."id" = l."release_id"
JOIN "products" p ON p."id" = r."product_id"
WHERE r."status" = 'published'
ON CONFLICT ("release_id", "cancellation_reason_id") DO NOTHING;