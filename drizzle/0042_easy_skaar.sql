CREATE TYPE "public"."roadmap_visibility" AS ENUM('public', 'unlisted');--> statement-breakpoint
CREATE TABLE "public_roadmaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"visibility" "roadmap_visibility" DEFAULT 'public' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_roadmaps_product_slug_unique" UNIQUE("product_id","slug"),
	CONSTRAINT "public_roadmaps_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
CREATE TABLE "roadmap_boards" (
	"roadmap_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_boards_pk" PRIMARY KEY("roadmap_id","board_id")
);
--> statement-breakpoint
CREATE TABLE "subscriber_topic_preferences" (
	"subscriber_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"subscribed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriber_topic_preferences_pk" PRIMARY KEY("subscriber_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_topics_product_key_unique" UNIQUE("product_id","key"),
	CONSTRAINT "subscription_topics_id_product_unique" UNIQUE("id","product_id")
);
--> statement-breakpoint
ALTER TABLE "public_roadmaps" ADD CONSTRAINT "public_roadmaps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_roadmaps" ADD CONSTRAINT "public_roadmaps_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_boards" ADD CONSTRAINT "roadmap_boards_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_boards" ADD CONSTRAINT "roadmap_boards_roadmap_fk" FOREIGN KEY ("roadmap_id","product_id") REFERENCES "public"."public_roadmaps"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_boards" ADD CONSTRAINT "roadmap_boards_board_fk" FOREIGN KEY ("board_id","product_id") REFERENCES "public"."boards"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_id_product_unique" UNIQUE("id","product_id");--> statement-breakpoint
ALTER TABLE "subscriber_topic_preferences" ADD CONSTRAINT "subscriber_topic_preferences_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_topic_preferences" ADD CONSTRAINT "subscriber_topic_preferences_subscriber_fk" FOREIGN KEY ("subscriber_id","product_id") REFERENCES "public"."subscribers"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_topic_preferences" ADD CONSTRAINT "subscriber_topic_preferences_topic_fk" FOREIGN KEY ("topic_id","product_id") REFERENCES "public"."subscription_topics"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_topics" ADD CONSTRAINT "subscription_topics_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_roadmaps_product_position_idx" ON "public_roadmaps" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "public_roadmaps_workspace_idx" ON "public_roadmaps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "roadmap_boards_board_idx" ON "roadmap_boards" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "subscriber_topic_preferences_topic_idx" ON "subscriber_topic_preferences" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "subscription_topics_product_position_idx" ON "subscription_topics" USING btree ("product_id","position");