ALTER TYPE "public"."job_type" ADD VALUE 'slack_support_message' BEFORE 'issue_tracker_event';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'slack_support_mirror' BEFORE 'issue_tracker_event';--> statement-breakpoint
CREATE TABLE "slack_conversation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"created_by_slack_user" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_conversation_links_conversation_unique" UNIQUE("conversation_id"),
	CONSTRAINT "slack_conversation_links_thread_unique" UNIQUE("team_id","channel_id","thread_ts")
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_channel_ck";--> statement-breakpoint
ALTER TABLE "slack_conversation_links" ADD CONSTRAINT "slack_conversation_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_links" ADD CONSTRAINT "slack_conversation_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_links" ADD CONSTRAINT "slack_conversation_links_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_conversation_links_product_idx" ON "slack_conversation_links" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_channel_ck" CHECK ("conversation_messages"."channel" in ('team', 'widget', 'email', 'slack'));