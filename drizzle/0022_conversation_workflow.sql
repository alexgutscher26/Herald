CREATE TYPE "public"."conversation_notification_kind" AS ENUM('new_conversation', 'reply');--> statement-breakpoint
CREATE TABLE "conversation_drafts" (
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_drafts_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "conversation_drafts_body_ck" CHECK (length("conversation_drafts"."body") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "conversation_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"user_id" text NOT NULL,
	"kind" "conversation_notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "source_context" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "away_reply_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD COLUMN "notify_in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD COLUMN "notify_new_conversations" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD COLUMN "notify_replies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD COLUMN "away_reply_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD COLUMN "away_reply_body" text DEFAULT 'Thanks for your message. Our team is away right now and will reply as soon as we are back.' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_drafts" ADD CONSTRAINT "conversation_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_drafts" ADD CONSTRAINT "conversation_drafts_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notifications" ADD CONSTRAINT "conversation_notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notifications" ADD CONSTRAINT "conversation_notifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notifications" ADD CONSTRAINT "conversation_notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notifications" ADD CONSTRAINT "conversation_notifications_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_notifications_user_read_idx" ON "conversation_notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "conversation_notifications_product_created_idx" ON "conversation_notifications" USING btree ("product_id","created_at");