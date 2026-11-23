ALTER TABLE "workspace_branding" ADD COLUMN "content_translation_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN "outbound_message_id" uuid;--> statement-breakpoint
ALTER TABLE "help_article_revisions" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "help_articles" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;