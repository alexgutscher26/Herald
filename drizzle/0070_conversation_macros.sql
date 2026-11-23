-- Conversation tags and macros.
--
-- A macro is a small, product-scoped recipe: reply, add one tag, set a status
-- and/or assign an operator. Null fields leave the thread untouched. Tags stay
-- flat so applying a macro never needs a taxonomy screen.

CREATE TABLE IF NOT EXISTS "conversation_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tags_product_name_unique"
  ON "conversation_tags" ("product_id", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tags_id_product_unique"
  ON "conversation_tags" ("id", "product_id");

CREATE INDEX IF NOT EXISTS "conversation_tags_product_idx"
  ON "conversation_tags" ("product_id");

CREATE TABLE IF NOT EXISTS "conversation_tag_links" (
  "conversation_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_tag_links_pk" PRIMARY KEY ("conversation_id", "tag_id"),
  CONSTRAINT "conversation_tag_links_conversation_fk"
    FOREIGN KEY ("conversation_id", "product_id")
    REFERENCES "conversations" ("id", "product_id") ON DELETE CASCADE,
  CONSTRAINT "conversation_tag_links_tag_fk"
    FOREIGN KEY ("tag_id", "product_id")
    REFERENCES "conversation_tags" ("id", "product_id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "conversation_tag_links_tag_idx"
  ON "conversation_tag_links" ("tag_id", "conversation_id");

CREATE TABLE IF NOT EXISTS "conversation_macros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "reply_body" text NOT NULL DEFAULT '',
  "tag_name" text,
  "status" "conversation_status",
  "assignee_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_macros_reply_ck" CHECK (length("reply_body") <= 10000),
  CONSTRAINT "conversation_macros_tag_ck" CHECK ("tag_name" IS NULL OR length("tag_name") <= 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_macros_product_name_unique"
  ON "conversation_macros" ("product_id", "name");

CREATE INDEX IF NOT EXISTS "conversation_macros_product_idx"
  ON "conversation_macros" ("product_id");

-- Applying a macro can add a tag without writing a message. The thread should
-- still refresh on other open dashboards, so tag links join the existing
-- conversation event feed.
CREATE OR REPLACE FUNCTION herald_notify_conversation_tag() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'herald_conversation_events',
    json_build_object(
      'type', 'conversation',
      'event', 'update',
      'productId', NEW.product_id::text,
      'conversationId', NEW.conversation_id::text,
      'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversation_tag_links_event_feed ON conversation_tag_links;
CREATE TRIGGER conversation_tag_links_event_feed
  AFTER INSERT ON conversation_tag_links
  FOR EACH ROW EXECUTE FUNCTION herald_notify_conversation_tag();
