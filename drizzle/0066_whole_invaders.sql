CREATE TYPE "public"."release_reaction_kind" AS ENUM('like', 'love', 'celebrate');--> statement-breakpoint
CREATE TABLE "release_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "release_reaction_kind" DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_reactions_release_customer_kind_unique" UNIQUE("release_id","customer_id","kind")
);
--> statement-breakpoint
ALTER TABLE "release_revisions" ADD COLUMN "og_image_key" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "og_image_key" text;--> statement-breakpoint
ALTER TABLE "release_reactions" ADD CONSTRAINT "release_reactions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_reactions" ADD CONSTRAINT "release_reactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_reactions" ADD CONSTRAINT "release_reactions_release_fk" FOREIGN KEY ("release_id","product_id") REFERENCES "public"."releases"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_reactions_release_idx" ON "release_reactions" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_reactions_customer_idx" ON "release_reactions" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "release_revisions" ADD CONSTRAINT "release_revisions_og_image_key_ck" CHECK ("release_revisions"."og_image_key" is null or ("release_revisions"."og_image_key" not like '%..%' and "release_revisions"."og_image_key" like 'workspaces/%/social/%'));--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_og_image_key_ck" CHECK ("releases"."og_image_key" is null or ("releases"."og_image_key" not like '%..%' and "releases"."og_image_key" like 'workspaces/%/social/%'));