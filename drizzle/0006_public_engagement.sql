CREATE TABLE "feedback_customer_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_customer_votes_post_customer_unique" UNIQUE("feedback_post_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD COLUMN "author_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_customer_votes" ADD CONSTRAINT "feedback_customer_votes_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_customer_votes" ADD CONSTRAINT "feedback_customer_votes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_customer_votes_post_idx" ON "feedback_customer_votes" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_customer_votes_customer_idx" ON "feedback_customer_votes" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_author_customer_id_customers_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;