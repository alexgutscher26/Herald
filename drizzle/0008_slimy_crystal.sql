CREATE TABLE "feedback_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_post_id" uuid NOT NULL,
	"target_post_id" uuid NOT NULL,
	"source_status" "feedback_status" NOT NULL,
	"moved_comment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"moved_attachment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"moved_vote_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"moved_customer_vote_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"moved_reaction_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"moved_follower_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"moved_tag_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"moved_roadmap_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" text,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "hidden_by" text;--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD CONSTRAINT "feedback_merges_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD CONSTRAINT "feedback_merges_source_post_id_feedback_posts_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD CONSTRAINT "feedback_merges_target_post_id_feedback_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD CONSTRAINT "feedback_merges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_merges_source_idx" ON "feedback_merges" USING btree ("source_post_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_merges_target_idx" ON "feedback_merges" USING btree ("target_post_id");--> statement-breakpoint
CREATE INDEX "feedback_merges_product_idx" ON "feedback_merges" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_hidden_by_user_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_posts_board_hidden_idx" ON "feedback_posts" USING btree ("board_id","hidden_at");