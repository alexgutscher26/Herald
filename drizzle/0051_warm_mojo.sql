CREATE TYPE "public"."help_article_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."help_article_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."help_collection_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."api_doc_source" AS ENUM('file', 'url', 'ci');--> statement-breakpoint
CREATE TYPE "public"."api_doc_version_status" AS ENUM('draft', 'live', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."knowledge_source_kind" ADD VALUE 'help_collection';--> statement-breakpoint
ALTER TYPE "public"."knowledge_source_kind" ADD VALUE 'api_docs';--> statement-breakpoint
CREATE TABLE "help_article_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"visibility" "help_article_visibility" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_article_revisions_number_unique" UNIQUE("article_id","revision_number")
);
--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "help_article_status" DEFAULT 'draft' NOT NULL,
	"visibility" "help_article_visibility" DEFAULT 'public' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_articles_collection_slug_unique" UNIQUE("collection_id","slug"),
	CONSTRAINT "help_articles_title_ck" CHECK (length("help_articles"."title") between 1 and 200),
	CONSTRAINT "help_articles_slug_ck" CHECK ("help_articles"."slug" ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
	CONSTRAINT "help_articles_body_ck" CHECK (length("help_articles"."body") between 1 and 500000)
);
--> statement-breakpoint
CREATE TABLE "help_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "help_collection_visibility" DEFAULT 'public' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_collections_product_slug_unique" UNIQUE("product_id","slug"),
	CONSTRAINT "help_collections_name_ck" CHECK (length("help_collections"."name") between 1 and 120),
	CONSTRAINT "help_collections_slug_ck" CHECK ("help_collections"."slug" ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);
--> statement-breakpoint
CREATE TABLE "api_doc_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_doc_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" text NOT NULL,
	"source" "api_doc_source" NOT NULL,
	"source_url" text,
	"status" "api_doc_version_status" DEFAULT 'draft' NOT NULL,
	"document" jsonb NOT NULL,
	"breaking_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "api_doc_versions_doc_version_unique" UNIQUE("api_doc_id","version"),
	CONSTRAINT "api_doc_versions_version_ck" CHECK (length("api_doc_versions"."version") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "api_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_docs_product_slug_unique" UNIQUE("product_id","slug"),
	CONSTRAINT "api_docs_name_ck" CHECK (length("api_docs"."name") between 1 and 120),
	CONSTRAINT "api_docs_slug_ck" CHECK ("api_docs"."slug" ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" DROP CONSTRAINT "knowledge_sources_url_ck";--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "origin_id" uuid;--> statement-breakpoint
ALTER TABLE "help_article_revisions" ADD CONSTRAINT "help_article_revisions_article_id_help_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."help_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_article_revisions" ADD CONSTRAINT "help_article_revisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_article_revisions" ADD CONSTRAINT "help_article_revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_collection_id_help_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."help_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_collections" ADD CONSTRAINT "help_collections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_collections" ADD CONSTRAINT "help_collections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_collections" ADD CONSTRAINT "help_collections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_doc_versions" ADD CONSTRAINT "api_doc_versions_api_doc_id_api_docs_id_fk" FOREIGN KEY ("api_doc_id") REFERENCES "public"."api_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_doc_versions" ADD CONSTRAINT "api_doc_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_doc_versions" ADD CONSTRAINT "api_doc_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_docs" ADD CONSTRAINT "api_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_docs" ADD CONSTRAINT "api_docs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_docs" ADD CONSTRAINT "api_docs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "help_article_revisions_article_idx" ON "help_article_revisions" USING btree ("article_id","revision_number");--> statement-breakpoint
CREATE INDEX "help_articles_product_status_idx" ON "help_articles" USING btree ("product_id","status","visibility");--> statement-breakpoint
CREATE INDEX "help_collections_product_order_idx" ON "help_collections" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "api_doc_versions_doc_created_idx" ON "api_doc_versions" USING btree ("api_doc_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_doc_versions_one_live_idx" ON "api_doc_versions" USING btree ("api_doc_id") WHERE "api_doc_versions"."status" = 'live';--> statement-breakpoint
CREATE INDEX "api_docs_product_idx" ON "api_docs" USING btree ("product_id","created_at");--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_origin_ck" CHECK (("knowledge_sources"."kind"::text IN ('help_collection', 'api_docs') AND "knowledge_sources"."origin_id" IS NOT NULL) OR ("knowledge_sources"."kind" IN ('upload', 'url') AND "knowledge_sources"."origin_id" IS NULL));--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_url_ck" CHECK (("knowledge_sources"."kind" = 'url' AND "knowledge_sources"."url" IS NOT NULL) OR ("knowledge_sources"."kind"::text IN ('upload', 'help_collection', 'api_docs') AND "knowledge_sources"."url" IS NULL));