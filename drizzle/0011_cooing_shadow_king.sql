CREATE TABLE "feedback_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{"search":"","status":"all","category":"all","sort":"newest"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_saved_views" ADD CONSTRAINT "feedback_saved_views_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_saved_views" ADD CONSTRAINT "feedback_saved_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_saved_views_product_user_name_unique" ON "feedback_saved_views" USING btree ("product_id","user_id","name");--> statement-breakpoint
CREATE INDEX "feedback_saved_views_product_user_idx" ON "feedback_saved_views" USING btree ("product_id","user_id");