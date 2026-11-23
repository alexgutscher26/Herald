ALTER TYPE "public"."notification_template" ADD VALUE 'conversation_reply' BEFORE 'weekly_digest';--> statement-breakpoint
CREATE TABLE "product_email_settings" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"display_name" text DEFAULT 'Support' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_email_settings_token_unique" UNIQUE("token"),
	CONSTRAINT "product_email_settings_token_ck" CHECK (length("product_email_settings"."token") >= 8)
);
--> statement-breakpoint
CREATE TABLE "workspace_operators" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"schedule" jsonb,
	"available_while_using" boolean DEFAULT true NOT NULL,
	"appear_offline" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_operators_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_operators_timezone_ck" CHECK (length("workspace_operators"."timezone") > 0)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "conversation_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "channel" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "reply_token" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "unread_for_customer" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_email_settings" ADD CONSTRAINT "product_email_settings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD CONSTRAINT "workspace_operators_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operators" ADD CONSTRAINT "workspace_operators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_conversation_message_id_conversation_messages_id_fk" FOREIGN KEY ("conversation_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_conversation_idx" ON "notification_deliveries" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_external_unique" ON "conversation_messages" USING btree ("external_id") WHERE "conversation_messages"."external_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_reply_token_unique" UNIQUE("reply_token");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_channel_ck" CHECK ("conversation_messages"."channel" in ('team', 'widget', 'email'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_unread_ck" CHECK ("conversations"."unread_for_customer" >= 0);