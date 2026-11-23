CREATE TYPE "public"."juno_knowledge_task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "juno_knowledge_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" "juno_knowledge_task_status" DEFAULT 'open' NOT NULL,
	"created_by" text,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_knowledge_tasks_answer_unique" UNIQUE("answer_id"),
	CONSTRAINT "juno_knowledge_tasks_question_ck" CHECK (length("juno_knowledge_tasks"."question") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "juno_redaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"email_count" integer DEFAULT 0 NOT NULL,
	"phone_count" integer DEFAULT 0 NOT NULL,
	"card_count" integer DEFAULT 0 NOT NULL,
	"iban_count" integer DEFAULT 0 NOT NULL,
	"ssn_count" integer DEFAULT 0 NOT NULL,
	"secret_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_redaction_events_message_unique" UNIQUE("message_id"),
	CONSTRAINT "juno_redaction_events_counts_ck" CHECK ("juno_redaction_events"."email_count" >= 0 AND "juno_redaction_events"."phone_count" >= 0 AND "juno_redaction_events"."card_count" >= 0
        AND "juno_redaction_events"."iban_count" >= 0 AND "juno_redaction_events"."ssn_count" >= 0 AND "juno_redaction_events"."secret_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "juno_usage" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "juno_knowledge_tasks" ADD CONSTRAINT "juno_knowledge_tasks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_knowledge_tasks" ADD CONSTRAINT "juno_knowledge_tasks_answer_id_juno_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."juno_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_knowledge_tasks" ADD CONSTRAINT "juno_knowledge_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_knowledge_tasks" ADD CONSTRAINT "juno_knowledge_tasks_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_redaction_events" ADD CONSTRAINT "juno_redaction_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juno_redaction_events" ADD CONSTRAINT "juno_redaction_events_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "juno_knowledge_tasks_product_status_idx" ON "juno_knowledge_tasks" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "juno_redaction_events_product_created_idx" ON "juno_redaction_events" USING btree ("product_id","created_at");