ALTER TYPE "public"."notification_template" ADD VALUE 'conversation_csat' BEFORE 'conversation_notification';--> statement-breakpoint
CREATE TABLE "customer_release_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"view_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_release_views_customer_release_unique" UNIQUE("customer_id","release_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"target_conversation_id" uuid NOT NULL,
	"moved_messages" integer DEFAULT 0 NOT NULL,
	"moved_tags" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_spam_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"verdict" text DEFAULT 'false_positive' NOT NULL,
	"reasons" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "csat_rerated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_support_settings" ADD COLUMN "spam_rules" jsonb;--> statement-breakpoint
ALTER TABLE "customer_release_views" ADD CONSTRAINT "customer_release_views_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_release_views" ADD CONSTRAINT "customer_release_views_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_release_views" ADD CONSTRAINT "customer_release_views_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_merges" ADD CONSTRAINT "conversation_merges_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_merges" ADD CONSTRAINT "conversation_merges_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_merges" ADD CONSTRAINT "conversation_merges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_spam_feedback" ADD CONSTRAINT "conversation_spam_feedback_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_spam_feedback" ADD CONSTRAINT "conversation_spam_feedback_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_release_views_customer_idx" ON "customer_release_views" USING btree ("customer_id","last_viewed_at");--> statement-breakpoint
CREATE INDEX "conversation_merges_product_idx" ON "conversation_merges" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_merges_source_idx" ON "conversation_merges" USING btree ("source_conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_spam_feedback_product_idx" ON "conversation_spam_feedback" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_spam_feedback_conversation_idx" ON "conversation_spam_feedback" USING btree ("conversation_id");