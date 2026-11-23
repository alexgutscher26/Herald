CREATE TYPE "public"."feedback_bulk_action_kind" AS ENUM('status', 'visibility', 'assignee', 'board', 'tag');--> statement-breakpoint
CREATE TABLE "feedback_bulk_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"actor_id" text,
	"kind" "feedback_bulk_action_kind" NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "public_planned_for" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "planned_for" text;--> statement-breakpoint
ALTER TABLE "feedback_bulk_actions" ADD CONSTRAINT "feedback_bulk_actions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_bulk_actions" ADD CONSTRAINT "feedback_bulk_actions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_bulk_actions_product_time_idx" ON "feedback_bulk_actions" USING btree ("product_id","created_at");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_planned_for_ck" CHECK ("feedback_posts"."planned_for" IS NULL OR "feedback_posts"."planned_for" ~ '^[0-9]{4}-(Q[1-4]|[0-9]{2}-[0-9]{2})$');