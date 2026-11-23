CREATE TABLE "release_authors" (
	"release_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_authors_pk" PRIMARY KEY("release_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "release_tag_links" (
	"release_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_tag_links_pk" PRIMARY KEY("release_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "release_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_tags_product_slug_unique" UNIQUE("product_id","slug"),
	CONSTRAINT "release_tags_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "public_changelog_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "youtube_url" text;--> statement-breakpoint
INSERT INTO "release_authors" ("release_id", "product_id", "user_id", "position")
SELECT "id", "product_id", "author_id", 0
FROM "releases"
WHERE "author_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "release_authors" ADD CONSTRAINT "release_authors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_authors" ADD CONSTRAINT "release_authors_release_fk" FOREIGN KEY ("release_id","product_id") REFERENCES "public"."releases"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tag_links" ADD CONSTRAINT "release_tag_links_release_fk" FOREIGN KEY ("release_id","product_id") REFERENCES "public"."releases"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tag_links" ADD CONSTRAINT "release_tag_links_tag_fk" FOREIGN KEY ("tag_id","product_id") REFERENCES "public"."release_tags"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tags" ADD CONSTRAINT "release_tags_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_authors_user_idx" ON "release_authors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "release_authors_product_idx" ON "release_authors" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "release_tag_links_release_idx" ON "release_tag_links" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_tag_links_product_idx" ON "release_tag_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "release_tags_product_idx" ON "release_tags" USING btree ("product_id");