-- Business-hours-aware first-response SLA.
--
-- The clock is opt-in per product. It is evaluated from the customer's last
-- message and the product's weekly windows; no timer row is needed. A breach is
-- recorded on the conversation so the sweep is idempotent, and a later customer
-- message makes the row eligible again because its timestamp is older than that
-- message.

ALTER TABLE "product_support_settings"
  ADD COLUMN IF NOT EXISTS "sla_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sla_first_response_minutes" integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS "sla_business_hours" jsonb,
  ADD COLUMN IF NOT EXISTS "sla_timezone" text NOT NULL DEFAULT 'UTC';

ALTER TABLE "product_support_settings"
  ADD CONSTRAINT "product_support_settings_sla_minutes_ck"
  CHECK ("sla_first_response_minutes" >= 5 AND "sla_first_response_minutes" <= 10080);

ALTER TABLE "product_support_settings"
  ADD CONSTRAINT "product_support_settings_sla_hours_ck"
  CHECK (
    "sla_business_hours" IS NULL
    OR jsonb_typeof("sla_business_hours") = 'array'
  );

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "sla_breached_at" timestamptz;

ALTER TYPE "conversation_notification_kind" ADD VALUE IF NOT EXISTS 'sla_breach';
