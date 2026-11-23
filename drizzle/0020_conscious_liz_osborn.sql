CREATE TYPE "public"."conversation_message_author" AS ENUM('customer', 'team', 'system');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_kind" AS ENUM('message', 'note');--> statement-breakpoint
CREATE TYPE "public"."conversation_participant_role" AS ENUM('customer', 'team');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('queue', 'open', 'snoozed', 'resolved', 'spam', 'archived');--> statement-breakpoint
CREATE TABLE "conversation_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"message_id" uuid,
	"kind" text DEFAULT 'file' NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_attachments_kind_ck" CHECK ("conversation_attachments"."kind" in ('image', 'file')),
	CONSTRAINT "conversation_attachments_size_ck" CHECK ("conversation_attachments"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"author_type" "conversation_message_author" NOT NULL,
	"author_user_id" text,
	"author_customer_id" uuid,
	"kind" "conversation_message_kind" DEFAULT 'message' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "conversation_messages_author_ck" CHECK (("conversation_messages"."author_type" = 'team' AND "conversation_messages"."author_user_id" IS NOT NULL)
        OR ("conversation_messages"."author_type" = 'customer' AND "conversation_messages"."author_customer_id" IS NOT NULL)
        OR "conversation_messages"."author_type" = 'system')
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"role" "conversation_participant_role" NOT NULL,
	"user_id" text,
	"customer_id" uuid,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"assignee_id" text,
	"status" "conversation_status" DEFAULT 'queue' NOT NULL,
	"subject" text NOT NULL,
	"source_url" text,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_customer_message_at" timestamp with time zone,
	"unread_for_team" integer DEFAULT 0 NOT NULL,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "conversations_unread_ck" CHECK ("conversations"."unread_for_team" >= 0),
	CONSTRAINT "conversations_snooze_ck" CHECK ("conversations"."status" <> 'snoozed' OR "conversations"."snoozed_until" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_message_fk" FOREIGN KEY ("message_id","product_id") REFERENCES "public"."conversation_messages"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_customer_id_customers_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reminders" ADD CONSTRAINT "conversation_reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reminders" ADD CONSTRAINT "conversation_reminders_conversation_fk" FOREIGN KEY ("conversation_id","product_id") REFERENCES "public"."conversations"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_attachments_thread_idx" ON "conversation_attachments" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_thread_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_user_unique" ON "conversation_participants" USING btree ("conversation_id","user_id") WHERE "conversation_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_customer_unique" ON "conversation_participants" USING btree ("conversation_id","customer_id") WHERE "conversation_participants"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id","last_read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_reminders_active_unique" ON "conversation_reminders" USING btree ("conversation_id","user_id") WHERE "conversation_reminders"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "conversation_reminders_user_due_idx" ON "conversation_reminders" USING btree ("user_id","remind_at");--> statement-breakpoint
CREATE INDEX "conversations_product_status_idx" ON "conversations" USING btree ("product_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_product_assignee_idx" ON "conversations" USING btree ("product_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "conversations_customer_idx" ON "conversations" USING btree ("customer_id");