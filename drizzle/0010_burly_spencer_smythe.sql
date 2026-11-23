CREATE TYPE "public"."public_locale" AS ENUM('auto', 'en', 'es');--> statement-breakpoint
CREATE TYPE "public"."public_theme" AS ENUM('light', 'dark', 'auto');--> statement-breakpoint
CREATE TABLE "workspace_branding" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"brand_name" text,
	"logo_key" text,
	"primary_color" text,
	"theme" "public_theme" DEFAULT 'light' NOT NULL,
	"locale" "public_locale" DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_branding" ADD CONSTRAINT "workspace_branding_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;