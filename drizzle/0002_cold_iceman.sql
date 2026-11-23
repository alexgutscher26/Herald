CREATE TYPE "public"."board_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."feedback_follower_source" AS ENUM('board', 'widget', 'api', 'import');--> statement-breakpoint
CREATE TYPE "public"."feedback_reaction_kind" AS ENUM('like', 'love', 'celebrate');--> statement-breakpoint
CREATE TYPE "public"."moderation_content_type" AS ENUM('feedback_post', 'feedback_comment');--> statement-breakpoint
CREATE TYPE "public"."moderation_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "customer_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"domain" text,
	"domain_normalized" text,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_companies_workspace_external_unique" UNIQUE("workspace_id","external_id"),
	CONSTRAINT "customer_companies_id_workspace_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "customer_company_memberships" (
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_company_memberships_pk" PRIMARY KEY("company_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"guest" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_id" text,
	"email" text,
	"email_normalized" text,
	"name" text,
	"avatar_url" text,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"banned_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_workspace_email_unique" UNIQUE("workspace_id","email_normalized"),
	CONSTRAINT "customers_workspace_external_unique" UNIQUE("workspace_id","external_id"),
	CONSTRAINT "customers_id_workspace_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "board_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_tags_board_name_unique" UNIQUE("board_id","name"),
	CONSTRAINT "board_tags_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"visibility" "board_visibility" DEFAULT 'public' NOT NULL,
	"guest_posting" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{"moderation":{"requireApproval":"none","comments":"open","blockSensitiveInfo":false}}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_product_slug_unique" UNIQUE("product_id","slug"),
	CONSTRAINT "boards_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "blocked_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid,
	"email_normalized" text,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_customers_identity_ck" CHECK ("blocked_customers"."customer_id" IS NOT NULL OR "blocked_customers"."email_normalized" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "feedback_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid,
	"feedback_comment_id" uuid,
	"uploaded_by_customer_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "feedback_attachments_one_target_ck" CHECK (("feedback_attachments"."feedback_post_id" IS NULL) <> ("feedback_attachments"."feedback_comment_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "feedback_followers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"source" "feedback_follower_source" DEFAULT 'board' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_followers_post_customer_unique" UNIQUE("feedback_post_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_post_id" uuid,
	"feedback_comment_id" uuid,
	"customer_id" uuid NOT NULL,
	"kind" "feedback_reaction_kind" DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reactions_one_target_ck" CHECK (("feedback_reactions"."feedback_post_id" IS NULL) <> ("feedback_reactions"."feedback_comment_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "feedback_tag_links" (
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_tag_links_pk" PRIMARY KEY("feedback_post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"content_type" "moderation_content_type" NOT NULL,
	"content_id" uuid NOT NULL,
	"status" "moderation_review_status" DEFAULT 'pending' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_id_product_unique" UNIQUE("id","product_id");--> statement-breakpoint
ALTER TABLE "customer_companies" ADD CONSTRAINT "customer_companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_company_memberships" ADD CONSTRAINT "customer_company_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_company_memberships" ADD CONSTRAINT "customer_company_memberships_customer_fk" FOREIGN KEY ("customer_id","workspace_id") REFERENCES "public"."customers"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_company_memberships" ADD CONSTRAINT "customer_company_memberships_company_fk" FOREIGN KEY ("company_id","workspace_id") REFERENCES "public"."customer_companies"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_fk" FOREIGN KEY ("customer_id","workspace_id") REFERENCES "public"."customers"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_tags" ADD CONSTRAINT "board_tags_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_tags" ADD CONSTRAINT "board_tags_board_product_fk" FOREIGN KEY ("board_id","product_id") REFERENCES "public"."boards"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_customers" ADD CONSTRAINT "blocked_customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_customers" ADD CONSTRAINT "blocked_customers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_customers" ADD CONSTRAINT "blocked_customers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_uploaded_by_customer_id_customers_id_fk" FOREIGN KEY ("uploaded_by_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_post_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_comment_fk" FOREIGN KEY ("feedback_comment_id","product_id") REFERENCES "public"."feedback_comments"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_followers" ADD CONSTRAINT "feedback_followers_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_followers" ADD CONSTRAINT "feedback_followers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reactions" ADD CONSTRAINT "feedback_reactions_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reactions" ADD CONSTRAINT "feedback_reactions_feedback_comment_id_feedback_comments_id_fk" FOREIGN KEY ("feedback_comment_id") REFERENCES "public"."feedback_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reactions" ADD CONSTRAINT "feedback_reactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_tag_links" ADD CONSTRAINT "feedback_tag_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_tag_links" ADD CONSTRAINT "feedback_tag_links_post_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_tag_links" ADD CONSTRAINT "feedback_tag_links_tag_fk" FOREIGN KEY ("tag_id","product_id") REFERENCES "public"."board_tags"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reviews" ADD CONSTRAINT "moderation_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reviews" ADD CONSTRAINT "moderation_reviews_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_companies_workspace_name_idx" ON "customer_companies" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "customer_companies_workspace_domain_idx" ON "customer_companies" USING btree ("workspace_id","domain_normalized");--> statement-breakpoint
CREATE INDEX "customer_company_memberships_customer_idx" ON "customer_company_memberships" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_company_memberships_company_idx" ON "customer_company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_idx" ON "customer_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customers_workspace_last_seen_idx" ON "customers" USING btree ("workspace_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "customers_workspace_banned_idx" ON "customers" USING btree ("workspace_id","banned_at");--> statement-breakpoint
CREATE INDEX "board_tags_board_position_idx" ON "board_tags" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "boards_product_position_idx" ON "boards" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "boards_product_visibility_idx" ON "boards" USING btree ("product_id","visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_customers_workspace_customer_unique" ON "blocked_customers" USING btree ("workspace_id","customer_id") WHERE "blocked_customers"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_customers_workspace_email_unique" ON "blocked_customers" USING btree ("workspace_id","email_normalized") WHERE "blocked_customers"."email_normalized" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "blocked_customers_workspace_created_idx" ON "blocked_customers" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_attachments_post_idx" ON "feedback_attachments" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_attachments_comment_idx" ON "feedback_attachments" USING btree ("feedback_comment_id");--> statement-breakpoint
CREATE INDEX "feedback_attachments_product_idx" ON "feedback_attachments" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "feedback_followers_post_idx" ON "feedback_followers" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_followers_customer_idx" ON "feedback_followers" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_reactions_post_customer_kind_unique" ON "feedback_reactions" USING btree ("feedback_post_id","customer_id","kind") WHERE "feedback_reactions"."feedback_post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_reactions_comment_customer_kind_unique" ON "feedback_reactions" USING btree ("feedback_comment_id","customer_id","kind") WHERE "feedback_reactions"."feedback_comment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_reactions_post_idx" ON "feedback_reactions" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_reactions_comment_idx" ON "feedback_reactions" USING btree ("feedback_comment_id");--> statement-breakpoint
CREATE INDEX "feedback_reactions_customer_idx" ON "feedback_reactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "feedback_tag_links_tag_idx" ON "feedback_tag_links" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "feedback_tag_links_product_idx" ON "feedback_tag_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "moderation_reviews_product_status_idx" ON "moderation_reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "moderation_reviews_content_idx" ON "moderation_reviews" USING btree ("content_type","content_id");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_posts_board_status_idx" ON "feedback_posts" USING btree ("board_id","status");--> statement-breakpoint
CREATE INDEX "feedback_posts_board_created_idx" ON "feedback_posts" USING btree ("board_id","created_at");