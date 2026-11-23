CREATE TYPE "public"."analytics_event_type" AS ENUM('board_view', 'request_view', 'submit_started', 'submission', 'vote', 'widget_open', 'widget_install');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'recalculate_analytics';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'purge_workspaces';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'prune_audit_events';--> statement-breakpoint
CREATE TABLE "feedback_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"feedback_post_id" uuid NOT NULL,
	"from_status" "feedback_status",
	"to_status" "feedback_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_product_day_metric_unique" UNIQUE("product_id","day","metric")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"board_id" uuid,
	"feedback_post_id" uuid,
	"type" "analytics_event_type" NOT NULL,
	"visitor_hash" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_deletions_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_status_history" ADD CONSTRAINT "feedback_status_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_status_history" ADD CONSTRAINT "feedback_status_history_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_feedback_post_id_feedback_posts_id_fk" FOREIGN KEY ("feedback_post_id") REFERENCES "public"."feedback_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_deletions" ADD CONSTRAINT "workspace_deletions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_deletions" ADD CONSTRAINT "workspace_deletions_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_history_post_time_idx" ON "feedback_status_history" USING btree ("feedback_post_id","changed_at");--> statement-breakpoint
CREATE INDEX "feedback_status_history_product_time_idx" ON "feedback_status_history" USING btree ("product_id","changed_at");--> statement-breakpoint
CREATE INDEX "analytics_daily_workspace_day_idx" ON "analytics_daily" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "analytics_daily_product_day_idx" ON "analytics_daily" USING btree ("product_id","day");--> statement-breakpoint
CREATE INDEX "analytics_events_product_time_idx" ON "analytics_events" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_product_type_time_idx" ON "analytics_events" USING btree ("product_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_workspace_time_idx" ON "analytics_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_board_time_idx" ON "analytics_events" USING btree ("board_id","occurred_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_workspace_time_idx" ON "workspace_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_action_time_idx" ON "workspace_audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "workspace_deletions_due_idx" ON "workspace_deletions" USING btree ("purge_after","cancelled_at");--> statement-breakpoint
CREATE INDEX "workspace_deletions_workspace_idx" ON "workspace_deletions" USING btree ("workspace_id");

-- Analytics history is written by the database, not by each application path.
-- This covers API writes, imports, merges and release publishing alike.
CREATE OR REPLACE FUNCTION "herald_record_feedback_status"()
RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "feedback_status_history" ("product_id", "feedback_post_id", "from_status", "to_status", "changed_at")
		VALUES (NEW."product_id", NEW."id", NULL, NEW."status", NEW."created_at");
		RETURN NEW;
	END IF;

	IF NEW."status" IS DISTINCT FROM OLD."status" THEN
		INSERT INTO "feedback_status_history" ("product_id", "feedback_post_id", "from_status", "to_status", "changed_at")
		VALUES (NEW."product_id", NEW."id", OLD."status", NEW."status", NEW."updated_at");
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Existing rows get one historical row. A shipped row's updated_at is the
-- closest available approximation for its first ship time; future transitions
-- are exact. The NOT EXISTS guard makes this safe to re-run.
INSERT INTO "feedback_status_history" ("product_id", "feedback_post_id", "from_status", "to_status", "changed_at")
SELECT p."product_id", p."id", NULL, p."status", p."created_at"
FROM "feedback_posts" p
WHERE NOT EXISTS (
	SELECT 1 FROM "feedback_status_history" h WHERE h."feedback_post_id" = p."id"
);

DROP TRIGGER IF EXISTS "feedback_status_history_insert" ON "feedback_posts";
CREATE TRIGGER "feedback_status_history_insert"
AFTER INSERT ON "feedback_posts"
FOR EACH ROW EXECUTE FUNCTION "herald_record_feedback_status"();

DROP TRIGGER IF EXISTS "feedback_status_history_update" ON "feedback_posts";
CREATE TRIGGER "feedback_status_history_update"
AFTER UPDATE OF "status" ON "feedback_posts"
FOR EACH ROW EXECUTE FUNCTION "herald_record_feedback_status"();

-- Public search is ILIKE '%term%'; a trigram index keeps it off a full scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "feedback_posts_title_trgm_idx"
ON "feedback_posts" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "feedback_posts_body_trgm_idx"
ON "feedback_posts" USING gin ("body" gin_trgm_ops);

-- The board and roadmap projections share the same public-visibility predicate.
CREATE INDEX IF NOT EXISTS "feedback_posts_board_public_idx"
ON "feedback_posts" ("board_id", "created_at" DESC)
WHERE "archived_at" IS NULL AND "hidden_at" IS NULL AND "merged_into_id" IS NULL;
CREATE INDEX IF NOT EXISTS "feedback_posts_product_status_public_idx"
ON "feedback_posts" ("product_id", "status")
WHERE "archived_at" IS NULL AND "hidden_at" IS NULL AND "merged_into_id" IS NULL;
CREATE INDEX IF NOT EXISTS "feedback_status_history_funnel_idx"
ON "feedback_status_history" ("product_id", "to_status", "changed_at");

-- Inbox list and first-response queries both sort by the latest activity.
CREATE INDEX IF NOT EXISTS "conversations_product_latest_idx"
ON "conversations" ("product_id", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "conversation_messages_author_time_idx"
ON "conversation_messages" ("conversation_id", "author_type", "created_at");