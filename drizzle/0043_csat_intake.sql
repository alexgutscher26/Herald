CREATE TYPE "public"."intake_channel" AS ENUM('widget', 'board', 'email');--> statement-breakpoint
CREATE TYPE "public"."intake_question_kind" AS ENUM('text', 'select');--> statement-breakpoint
CREATE TABLE "intake_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"board_id" uuid,
	"channel" "intake_channel" DEFAULT 'widget' NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" "intake_question_kind" DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_questions_key_ck" CHECK ("intake_questions"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "intake_questions_options_ck" CHECK (jsonb_typeof("intake_questions"."options") = 'array'),
	CONSTRAINT "intake_questions_board_channel_ck" CHECK ("intake_questions"."channel" = 'board' OR "intake_questions"."board_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "product_support_settings" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"csat_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "csat_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "csat_rating" smallint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "csat_rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_questions" ADD CONSTRAINT "intake_questions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_questions" ADD CONSTRAINT "intake_questions_board_fk" FOREIGN KEY ("board_id","product_id") REFERENCES "public"."boards"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_support_settings" ADD CONSTRAINT "product_support_settings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_questions_product_channel_idx" ON "intake_questions" USING btree ("product_id","channel","position");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_csat_rating_ck" CHECK ("conversations"."csat_rating" IS NULL OR ("conversations"."csat_rating" >= 1 AND "conversations"."csat_rating" <= 5));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_csat_rated_ck" CHECK ("conversations"."csat_rating" IS NULL OR ("conversations"."csat_requested_at" IS NOT NULL AND "conversations"."csat_rated_at" IS NOT NULL));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "herald_request_conversation_csat"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'resolved'
     AND OLD."status" IS DISTINCT FROM 'resolved'
     AND NEW."csat_requested_at" IS NULL
     AND EXISTS (
       SELECT 1 FROM "product_support_settings" s
       WHERE s."product_id" = NEW."product_id" AND s."csat_enabled"
     ) THEN
    NEW."csat_requested_at" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "conversations_csat_request"
BEFORE UPDATE OF "status" ON "conversations"
FOR EACH ROW EXECUTE FUNCTION "herald_request_conversation_csat"();