CREATE TYPE "public"."feedback_context_kind" AS ENUM('help_article', 'changelog');--> statement-breakpoint
CREATE TABLE "feedback_context_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"kind" "feedback_context_kind" NOT NULL,
	"ref_id" uuid NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_context_links_unique" UNIQUE("feedback_post_id","kind","ref_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_context_links" ADD CONSTRAINT "feedback_context_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_context_links" ADD CONSTRAINT "feedback_context_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_context_links" ADD CONSTRAINT "feedback_context_links_post_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_context_links_post_idx" ON "feedback_context_links" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_context_links_ref_idx" ON "feedback_context_links" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "feedback_context_links_product_idx" ON "feedback_context_links" USING btree ("product_id");