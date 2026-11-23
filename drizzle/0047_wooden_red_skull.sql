CREATE TABLE "customer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	CONSTRAINT "customer_events_product_event_unique" UNIQUE("product_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "webhooks" DROP CONSTRAINT "webhooks_events_ck";--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "events" SET DEFAULT '["request.created","request.updated","comment.created","changelog.created","conversation.updated","message.created","customer.event"]'::jsonb;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_customer_fk" FOREIGN KEY ("customer_id","workspace_id") REFERENCES "public"."customers"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_events_product_time_idx" ON "customer_events" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customer_events_customer_time_idx" ON "customer_events" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customer_events_product_name_time_idx" ON "customer_events" USING btree ("product_id","name","occurred_at");--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_events_ck" CHECK (jsonb_typeof("webhooks"."events") = 'array' and "webhooks"."events" <@ '["request.created","request.updated","comment.created","changelog.created","conversation.updated","message.created","customer.event"]'::jsonb);