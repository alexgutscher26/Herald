CREATE TYPE "public"."board_access_match" AS ENUM('company', 'email_domain', 'trait');--> statement-breakpoint
CREATE TABLE "board_access_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"match" "board_access_match" NOT NULL,
	"value" text NOT NULL,
	"trait_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_access_rules_unique" UNIQUE("board_id","match","trait_key","value")
);
--> statement-breakpoint
ALTER TABLE "board_access_rules" ADD CONSTRAINT "board_access_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_access_rules" ADD CONSTRAINT "board_access_rules_board_product_fk" FOREIGN KEY ("board_id","product_id") REFERENCES "public"."boards"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_access_rules_board_idx" ON "board_access_rules" USING btree ("board_id");