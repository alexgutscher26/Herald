CREATE TYPE "public"."lifetime_deal_status" AS ENUM('reserved', 'active', 'refunded', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."lifetime_seat_status" AS ENUM('available', 'reserved', 'active');--> statement-breakpoint
ALTER TYPE "public"."workspace_plan" ADD VALUE 'lifetime';--> statement-breakpoint
CREATE TABLE "lifetime_deals" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"purchaser_user_id" text,
	"seat_number" integer NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"amount_cents" integer DEFAULT 49900 NOT NULL,
	"status" "lifetime_deal_status" DEFAULT 'reserved' NOT NULL,
	"reserved_until" timestamp with time zone,
	"granted_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"terms_version" text DEFAULT '2026-11-21' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifetime_deals_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "lifetime_deals_seat_ck" CHECK ("lifetime_deals"."seat_number" >= 1 and "lifetime_deals"."seat_number" <= 100)
);
--> statement-breakpoint
CREATE TABLE "lifetime_seats" (
	"seat_number" integer PRIMARY KEY NOT NULL,
	"status" "lifetime_seat_status" DEFAULT 'available' NOT NULL,
	"reserved_until" timestamp with time zone,
	"workspace_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifetime_seats_number_ck" CHECK ("lifetime_seats"."seat_number" >= 1 and "lifetime_seats"."seat_number" <= 100)
);
--> statement-breakpoint
ALTER TABLE "lifetime_deals" ADD CONSTRAINT "lifetime_deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifetime_deals" ADD CONSTRAINT "lifetime_deals_purchaser_user_id_user_id_fk" FOREIGN KEY ("purchaser_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifetime_seats" ADD CONSTRAINT "lifetime_seats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lifetime_deals_active_purchaser_unique" ON "lifetime_deals" USING btree ("purchaser_user_id") WHERE "lifetime_deals"."status" in ('reserved', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "lifetime_deals_active_seat_unique" ON "lifetime_deals" USING btree ("seat_number") WHERE "lifetime_deals"."status" in ('reserved', 'active');--> statement-breakpoint
CREATE INDEX "lifetime_deals_status_idx" ON "lifetime_deals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lifetime_seats_status_idx" ON "lifetime_seats" USING btree ("status","seat_number");--> statement-breakpoint
-- The offer is exactly 100 workspaces. Pre-seeding numbered rows makes the
-- oversell guard a row lock, not a counter that can drift.
INSERT INTO "lifetime_seats" ("seat_number")
SELECT generate_series(1, 100)
ON CONFLICT ("seat_number") DO NOTHING;
