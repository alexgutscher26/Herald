ALTER TYPE "public"."winback_exclusion_reason" ADD VALUE 'segment_mismatch' BEFORE 'campaign_not_approved';--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_product_name_unique" UNIQUE("product_id","name")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "double_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirmation_token" text;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirmation_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD COLUMN "segment_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "segment_id" uuid;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_product_created_idx" ON "segments" USING btree ("product_id","created_at");--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_confirmation_token_unique" UNIQUE("confirmation_token");