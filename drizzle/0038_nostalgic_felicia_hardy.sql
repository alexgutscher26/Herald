CREATE TYPE "public"."feedback_insight_source" AS ENUM('support', 'chat', 'email', 'call', 'note', 'api', 'import');--> statement-breakpoint
CREATE TABLE "feedback_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"source" "feedback_insight_source" DEFAULT 'note' NOT NULL,
	"source_ref" text,
	"quote" text NOT NULL,
	"author_customer_id" uuid,
	"author_label" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD COLUMN "moved_insight_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_insights" ADD CONSTRAINT "feedback_insights_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_insights" ADD CONSTRAINT "feedback_insights_author_customer_id_customers_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_insights" ADD CONSTRAINT "feedback_insights_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_insights" ADD CONSTRAINT "feedback_insights_post_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_insights_post_time_idx" ON "feedback_insights" USING btree ("feedback_post_id","occurred_at");--> statement-breakpoint
CREATE INDEX "feedback_insights_product_time_idx" ON "feedback_insights" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "feedback_insights_customer_idx" ON "feedback_insights" USING btree ("author_customer_id");