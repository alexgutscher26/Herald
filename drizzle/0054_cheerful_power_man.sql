CREATE TABLE "widget_experience_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid,
	"visitor_key" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_experience_completions_visitor_unique" UNIQUE("experience_id","visitor_key")
);
--> statement-breakpoint
ALTER TABLE "widget_experience_completions" ADD CONSTRAINT "widget_experience_completions_experience_id_widget_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."widget_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_completions" ADD CONSTRAINT "widget_experience_completions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_completions" ADD CONSTRAINT "widget_experience_completions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_experience_completions" ADD CONSTRAINT "widget_experience_completions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "widget_experience_completions_product_idx" ON "widget_experience_completions" USING btree ("product_id","completed_at");