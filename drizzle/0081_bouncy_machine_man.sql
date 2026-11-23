CREATE TABLE "widget_experience_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid,
	"visitor_key" text NOT NULL,
	"shown_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_experience_views_visitor_day_unique" UNIQUE("experience_id","visitor_key","shown_on")
);
--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD COLUMN "schedule_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD COLUMN "schedule_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD COLUMN "frequency_cap" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD COLUMN "frequency_window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD COLUMN "preview_token_hash" text;--> statement-breakpoint
ALTER TABLE "widget_experiences" ADD COLUMN "preview_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "widget_experience_views" ADD CONSTRAINT "widget_experience_views_experience_id_widget_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."widget_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_views" ADD CONSTRAINT "widget_experience_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_views" ADD CONSTRAINT "widget_experience_views_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_views" ADD CONSTRAINT "widget_experience_views_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "widget_experience_views_experience_created_idx" ON "widget_experience_views" USING btree ("experience_id","created_at");--> statement-breakpoint
CREATE INDEX "widget_experience_views_workspace_idx" ON "widget_experience_views" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "widget_experiences_preview_idx" ON "widget_experiences" USING btree ("preview_token_hash");