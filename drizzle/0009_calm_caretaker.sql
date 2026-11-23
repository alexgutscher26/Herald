CREATE TYPE "public"."feedback_import_format" AS ENUM('generic', 'canny', 'productboard', 'nolt');--> statement-breakpoint
CREATE TYPE "public"."feedback_import_row_status" AS ENUM('pending', 'imported', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."feedback_import_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "feedback_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "feedback_import_row_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"feedback_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "feedback_import_rows_import_row_unique" UNIQUE("import_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "feedback_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"board_id" uuid,
	"format" "feedback_import_format" DEFAULT 'generic' NOT NULL,
	"file_name" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "feedback_import_status" DEFAULT 'queued' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "imported_vote_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD COLUMN "import_row_number" integer;--> statement-breakpoint
ALTER TABLE "feedback_merges" ADD COLUMN "moved_imported_votes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_import_rows" ADD CONSTRAINT "feedback_import_rows_import_id_feedback_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."feedback_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD CONSTRAINT "feedback_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD CONSTRAINT "feedback_imports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD CONSTRAINT "feedback_imports_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD CONSTRAINT "feedback_imports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_import_rows_pending_idx" ON "feedback_import_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "feedback_imports_product_created_idx" ON "feedback_imports" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_imports_status_idx" ON "feedback_imports" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "feedback_posts" ADD CONSTRAINT "feedback_posts_import_id_feedback_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."feedback_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_posts_import_row_unique" ON "feedback_posts" USING btree ("import_id","import_row_number") WHERE "feedback_posts"."import_id" IS NOT NULL;