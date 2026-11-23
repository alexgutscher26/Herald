CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'editor');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('draft', 'scheduled', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."feedback_source" AS ENUM('in_app', 'email', 'support', 'import', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('open', 'under_review', 'planned', 'in_progress', 'shipped', 'declined', 'closed');--> statement-breakpoint
CREATE TYPE "public"."roadmap_status" AS ENUM('under_review', 'planned', 'in_progress', 'shipped', 'declined');--> statement-breakpoint
CREATE TYPE "public"."subscriber_source" AS ENUM('widget', 'import', 'api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'active', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."attribution_basis" AS ENUM('none', 'inferred', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."campaign_approval_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."campaign_send_status" AS ENUM('not_sent', 'sending', 'sent', 'partially_sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."customer_provider" AS ENUM('manual', 'api', 'import', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'cancelled', 'reactivated', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."winback_eligibility" AS ENUM('unknown', 'eligible', 'ineligible');--> statement-breakpoint
CREATE TYPE "public"."winback_exclusion_reason" AS ENUM('no_email', 'ineligible', 'unsubscribed', 'winback_opted_out', 'already_received', 'campaign_not_approved');--> statement-breakpoint
CREATE TYPE "public"."winback_recipient_status" AS ENUM('pending', 'excluded', 'queued', 'sent', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'sent', 'failed', 'bounced', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."notification_template" AS ENUM('release_published', 'winback_campaign');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_workspace_slug_unique" UNIQUE("workspace_id","slug"),
	CONSTRAINT "products_id_workspace_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"body_markdown" text,
	"status" "release_status" DEFAULT 'draft' NOT NULL,
	"version" text,
	"published_at" timestamp with time zone,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_product_slug_unique" UNIQUE("product_id","slug"),
	CONSTRAINT "releases_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"author_id" text,
	"author_label" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "feedback_status" DEFAULT 'open' NOT NULL,
	"source" "feedback_source" DEFAULT 'other' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_posts_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"voter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_votes_post_voter_unique" UNIQUE("feedback_post_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "release_feedback_links" (
	"product_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_feedback_links_pk" PRIMARY KEY("release_id","feedback_post_id")
);
--> statement-breakpoint
CREATE TABLE "roadmap_feedback_links" (
	"product_id" uuid NOT NULL,
	"roadmap_item_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_feedback_links_pk" PRIMARY KEY("roadmap_item_id","feedback_post_id")
);
--> statement-breakpoint
CREATE TABLE "roadmap_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "roadmap_status" DEFAULT 'under_review' NOT NULL,
	"release_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_items_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"name" text,
	"status" "subscriber_status" DEFAULT 'active' NOT NULL,
	"source" "subscriber_source" DEFAULT 'manual' NOT NULL,
	"unsubscribe_token" text,
	"unsubscribed_at" timestamp with time zone,
	"winback_opted_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_unsubscribe_token_unique" UNIQUE("unsubscribe_token"),
	CONSTRAINT "subscribers_product_email_unique" UNIQUE("product_id","email_normalized")
);
--> statement-breakpoint
CREATE TABLE "cancellation_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"provider" "customer_provider" DEFAULT 'manual' NOT NULL,
	"email" text,
	"email_normalized" text,
	"name" text,
	"status" "customer_status" DEFAULT 'unknown' NOT NULL,
	"winback_eligibility" "winback_eligibility" DEFAULT 'unknown' NOT NULL,
	"winback_opted_out_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_product_provider_external_unique" UNIQUE("product_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "customer_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"cancellation_reason_id" uuid,
	"cancelled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_reason_links" (
	"release_id" uuid NOT NULL,
	"cancellation_reason_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_reason_links_pk" PRIMARY KEY("release_id","cancellation_reason_id")
);
--> statement-breakpoint
CREATE TABLE "winback_campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"email" text,
	"email_normalized" text,
	"status" "winback_recipient_status" DEFAULT 'pending' NOT NULL,
	"exclusion_reason" "winback_exclusion_reason",
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"attribution_basis" "attribution_basis" DEFAULT 'none' NOT NULL,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "winback_recipients_campaign_customer_unique" UNIQUE("campaign_id","customer_account_id")
);
--> statement-breakpoint
CREATE TABLE "winback_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"approval_status" "campaign_approval_status" DEFAULT 'draft' NOT NULL,
	"send_status" "campaign_send_status" DEFAULT 'not_sent' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_by" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"template" "notification_template" NOT NULL,
	"release_id" uuid,
	"winback_recipient_id" uuid,
	"recipient_email" text NOT NULL,
	"recipient_email_normalized" text NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_message_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notification_deliveries_single_source_ck" CHECK (("notification_deliveries"."release_id" IS NULL) <> ("notification_deliveries"."winback_recipient_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_feedback_links" ADD CONSTRAINT "release_feedback_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_feedback_links" ADD CONSTRAINT "release_feedback_links_release_fk" FOREIGN KEY ("release_id","product_id") REFERENCES "public"."releases"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_feedback_links" ADD CONSTRAINT "release_feedback_links_feedback_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_feedback_links" ADD CONSTRAINT "roadmap_feedback_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_feedback_links" ADD CONSTRAINT "roadmap_feedback_links_item_fk" FOREIGN KEY ("roadmap_item_id","product_id") REFERENCES "public"."roadmap_items"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_feedback_links" ADD CONSTRAINT "roadmap_feedback_links_feedback_fk" FOREIGN KEY ("feedback_post_id","product_id") REFERENCES "public"."feedback_posts"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_reasons" ADD CONSTRAINT "cancellation_reasons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cancellations" ADD CONSTRAINT "customer_cancellations_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cancellations" ADD CONSTRAINT "customer_cancellations_cancellation_reason_id_cancellation_reasons_id_fk" FOREIGN KEY ("cancellation_reason_id") REFERENCES "public"."cancellation_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_reason_links" ADD CONSTRAINT "release_reason_links_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_reason_links" ADD CONSTRAINT "release_reason_links_cancellation_reason_id_cancellation_reasons_id_fk" FOREIGN KEY ("cancellation_reason_id") REFERENCES "public"."cancellation_reasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaign_recipients" ADD CONSTRAINT "winback_campaign_recipients_campaign_id_winback_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."winback_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaign_recipients" ADD CONSTRAINT "winback_campaign_recipients_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winback_campaigns" ADD CONSTRAINT "winback_campaigns_product_workspace_fk" FOREIGN KEY ("product_id","workspace_id") REFERENCES "public"."products"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_winback_recipient_id_winback_campaign_recipients_id_fk" FOREIGN KEY ("winback_recipient_id") REFERENCES "public"."winback_campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_account_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "products_workspace_idx" ON "products" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspaces_created_by_idx" ON "workspaces" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "releases_product_status_published_idx" ON "releases" USING btree ("product_id","status","published_at");--> statement-breakpoint
CREATE INDEX "feedback_posts_product_status_idx" ON "feedback_posts" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "feedback_posts_product_created_idx" ON "feedback_posts" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_posts_author_idx" ON "feedback_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "feedback_votes_post_idx" ON "feedback_votes" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "feedback_votes_voter_idx" ON "feedback_votes" USING btree ("voter_id");--> statement-breakpoint
CREATE INDEX "release_feedback_links_feedback_idx" ON "release_feedback_links" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "release_feedback_links_product_idx" ON "release_feedback_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "roadmap_feedback_links_feedback_idx" ON "roadmap_feedback_links" USING btree ("feedback_post_id");--> statement-breakpoint
CREATE INDEX "roadmap_feedback_links_product_idx" ON "roadmap_feedback_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "roadmap_items_product_status_idx" ON "roadmap_items" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "subscribers_product_status_idx" ON "subscribers" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "subscribers_email_normalized_idx" ON "subscribers" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "cancellation_reasons_workspace_position_idx" ON "cancellation_reasons" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "customer_accounts_product_email_idx" ON "customer_accounts" USING btree ("product_id","email_normalized");--> statement-breakpoint
CREATE INDEX "customer_accounts_product_status_idx" ON "customer_accounts" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "customer_accounts_product_eligibility_idx" ON "customer_accounts" USING btree ("product_id","winback_eligibility");--> statement-breakpoint
CREATE INDEX "customer_cancellations_account_idx" ON "customer_cancellations" USING btree ("customer_account_id");--> statement-breakpoint
CREATE INDEX "customer_cancellations_reason_idx" ON "customer_cancellations" USING btree ("cancellation_reason_id");--> statement-breakpoint
CREATE INDEX "customer_cancellations_cancelled_at_idx" ON "customer_cancellations" USING btree ("cancelled_at");--> statement-breakpoint
CREATE INDEX "release_reason_links_reason_idx" ON "release_reason_links" USING btree ("cancellation_reason_id");--> statement-breakpoint
CREATE INDEX "winback_recipients_campaign_status_idx" ON "winback_campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "winback_recipients_customer_idx" ON "winback_campaign_recipients" USING btree ("customer_account_id");--> statement-breakpoint
CREATE INDEX "winback_recipients_message_id_idx" ON "winback_campaign_recipients" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "winback_campaigns_workspace_idx" ON "winback_campaigns" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "winback_campaigns_product_send_status_idx" ON "winback_campaigns" USING btree ("product_id","send_status");--> statement-breakpoint
CREATE INDEX "notification_deliveries_product_status_idx" ON "notification_deliveries" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "notification_deliveries_release_idx" ON "notification_deliveries" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_recipient_idx" ON "notification_deliveries" USING btree ("winback_recipient_id");