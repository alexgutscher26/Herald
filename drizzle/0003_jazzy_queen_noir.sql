CREATE TABLE "rate_limit_counters" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "feedback_posts" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "feedback_posts" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "feedback_posts" SET "status" = 'closed' WHERE "status" = 'declined';--> statement-breakpoint
DROP TYPE "public"."feedback_status";--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('open', 'under_review', 'planned', 'in_progress', 'shipped', 'closed');--> statement-breakpoint
ALTER TABLE "feedback_posts" ALTER COLUMN "status" SET DATA TYPE "public"."feedback_status" USING "status"::"public"."feedback_status";--> statement-breakpoint
ALTER TABLE "feedback_posts" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."feedback_status";--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "author_customer_id" uuid;--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_idx" ON "rate_limit_counters" USING btree ("window_start");--> statement-breakpoint
INSERT INTO "boards" ("id", "product_id", "name", "slug", "visibility", "position")
SELECT gen_random_uuid(), p."id", 'Feedback', 'feedback', 'public', 0
FROM "products" p
WHERE NOT EXISTS (
  SELECT 1 FROM "boards" b WHERE b."product_id" = p."id" AND b."slug" = 'feedback'
);--> statement-breakpoint
UPDATE "feedback_posts" fp
SET "board_id" = b."id"
FROM "boards" b
WHERE b."product_id" = fp."product_id"
  AND b."slug" = 'feedback'
  AND fp."board_id" IS NULL;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_author_customer_id_customers_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_posts_author_customer_idx" ON "feedback_posts" USING btree ("author_customer_id");