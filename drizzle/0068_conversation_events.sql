-- Conversation change feed for the dashboard SSE stream.
--
-- Triggers keep the feed correct for every writer (dashboard, widget, email,
-- Slack, Juno and future API handlers) instead of relying on each service to
-- remember a publish call. Payloads carry ids and metadata only, never message
-- bodies or customer data.

CREATE OR REPLACE FUNCTION herald_notify_conversation_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify(
      'herald_conversation_events',
      json_build_object(
        'type', 'conversation',
        'event', 'insert',
        'productId', NEW.product_id::text,
        'conversationId', NEW.id::text,
        'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
      )::text
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
     OR NEW.last_message_at IS DISTINCT FROM OLD.last_message_at THEN
    PERFORM pg_notify(
      'herald_conversation_events',
      json_build_object(
        'type', 'conversation',
        'event', 'update',
        'productId', NEW.product_id::text,
        'conversationId', NEW.id::text,
        'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION herald_notify_conversation_message() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'herald_conversation_events',
    json_build_object(
      'type', 'conversation',
      'event', CASE WHEN NEW.kind = 'note' THEN 'note' ELSE 'message' END,
      'productId', NEW.product_id::text,
      'conversationId', NEW.conversation_id::text,
      'authorType', NEW.author_type::text,
      'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION herald_notify_conversation_attachment() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'herald_conversation_events',
    json_build_object(
      'type', 'conversation',
      'event', 'attachment',
      'productId', NEW.product_id::text,
      'conversationId', NEW.conversation_id::text,
      'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversations_event_feed ON conversations;
CREATE TRIGGER conversations_event_feed
  AFTER INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION herald_notify_conversation_change();

DROP TRIGGER IF EXISTS conversation_messages_event_feed ON conversation_messages;
CREATE TRIGGER conversation_messages_event_feed
  AFTER INSERT ON conversation_messages
  FOR EACH ROW EXECUTE FUNCTION herald_notify_conversation_message();

DROP TRIGGER IF EXISTS conversation_attachments_event_feed ON conversation_attachments;
CREATE TRIGGER conversation_attachments_event_feed
  AFTER INSERT ON conversation_attachments
  FOR EACH ROW EXECUTE FUNCTION herald_notify_conversation_attachment();
