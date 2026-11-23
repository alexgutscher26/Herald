CREATE TYPE "public"."feedback_import_source" AS ENUM('csv', 'github', 'herald');--> statement-breakpoint
ALTER TYPE "public"."feedback_import_format" ADD VALUE 'frill';--> statement-breakpoint
ALTER TYPE "public"."feedback_import_format" ADD VALUE 'beamer';--> statement-breakpoint
ALTER TYPE "public"."feedback_import_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "feedback_import_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" "feedback_import_format" DEFAULT 'generic' NOT NULL,
	"signature" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_import_presets_workspace_signature_unique" UNIQUE("workspace_id","signature")
);
--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD COLUMN "source" "feedback_import_source" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD COLUMN "source_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD COLUMN "imported_attachments" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_imports" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_import_presets" ADD CONSTRAINT "feedback_import_presets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_import_presets" ADD CONSTRAINT "feedback_import_presets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_import_presets_workspace_idx" ON "feedback_import_presets" USING btree ("workspace_id","updated_at");