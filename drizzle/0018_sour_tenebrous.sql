CREATE TABLE "workspace_widget_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" text DEFAULT 'bottom-right' NOT NULL,
	"theme" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_widget_settings_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "workspace_widget_settings_position_ck" CHECK ("workspace_widget_settings"."position" in ('bottom-right', 'bottom-left', 'top-right', 'top-left')),
	CONSTRAINT "workspace_widget_settings_theme_ck" CHECK ("workspace_widget_settings"."theme" in ('light', 'dark', 'auto'))
);
--> statement-breakpoint
ALTER TABLE "workspace_widget_settings" ADD CONSTRAINT "workspace_widget_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;