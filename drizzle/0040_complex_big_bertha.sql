CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'select', 'date');--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fields_product_key_unique" UNIQUE("product_id","key"),
	CONSTRAINT "custom_fields_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "custom_fields_key_ck" CHECK ("custom_fields"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "custom_fields_select_options_ck" CHECK ("custom_fields"."type" <> 'select' or jsonb_array_length("custom_fields"."options") >= 1)
);
--> statement-breakpoint
CREATE TABLE "feedback_custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"text_value" text,
	"number_value" double precision,
	"date_value" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_custom_field_values_post_field_unique" UNIQUE("feedback_post_id","field_id"),
	CONSTRAINT "feedback_custom_field_values_one_value_ck" CHECK (num_nonnulls("feedback_custom_field_values"."text_value", "feedback_custom_field_values"."number_value", "feedback_custom_field_values"."date_value") = 1)
);
--> statement-breakpoint
CREATE TABLE "feedback_prioritisation" (
	"feedback_post_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"impact" integer,
	"business_value" integer,
	"effort" integer,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_prioritisation_impact_ck" CHECK ("feedback_prioritisation"."impact" is null or ("feedback_prioritisation"."impact" between 1 and 5)),
	CONSTRAINT "feedback_prioritisation_value_ck" CHECK ("feedback_prioritisation"."business_value" is null or ("feedback_prioritisation"."business_value" between 1 and 5)),
	CONSTRAINT "feedback_prioritisation_effort_ck" CHECK ("feedback_prioritisation"."effort" is null or ("feedback_prioritisation"."effort" between 1 and 5))
);
--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_custom_field_values" ADD CONSTRAINT "feedback_custom_field_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_custom_field_values" ADD CONSTRAINT "feedback_custom_field_values_post_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_custom_field_values" ADD CONSTRAINT "feedback_custom_field_values_field_fk" FOREIGN KEY ("field_id","product_id") REFERENCES "public"."custom_fields"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_prioritisation" ADD CONSTRAINT "feedback_prioritisation_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_prioritisation" ADD CONSTRAINT "feedback_prioritisation_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_prioritisation" ADD CONSTRAINT "feedback_prioritisation_post_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_fields_product_position_idx" ON "custom_fields" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "feedback_custom_field_values_field_text_idx" ON "feedback_custom_field_values" USING btree ("field_id","text_value");--> statement-breakpoint
CREATE INDEX "feedback_custom_field_values_field_number_idx" ON "feedback_custom_field_values" USING btree ("field_id","number_value");--> statement-breakpoint
CREATE INDEX "feedback_custom_field_values_field_date_idx" ON "feedback_custom_field_values" USING btree ("field_id","date_value");--> statement-breakpoint
CREATE INDEX "feedback_custom_field_values_post_idx" ON "feedback_custom_field_values" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_prioritisation_product_impact_idx" ON "feedback_prioritisation" USING btree ("product_id","impact");