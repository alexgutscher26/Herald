CREATE TABLE "survey_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"visitor_key" text NOT NULL,
	"shown_on" date NOT NULL,
	"source" text DEFAULT 'widget' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_impressions_visitor_day_unique" UNIQUE("survey_id","visitor_key","shown_on")
);
--> statement-breakpoint
ALTER TABLE "survey_impressions" ADD CONSTRAINT "survey_impressions_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_impressions" ADD CONSTRAINT "survey_impressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_impressions" ADD CONSTRAINT "survey_impressions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_impressions_workspace_created_idx" ON "survey_impressions" USING btree ("workspace_id","created_at");