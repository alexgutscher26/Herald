ALTER TABLE "api_tokens" ADD COLUMN "last_used_ip_prefix" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_used_user_agent" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_last_seen_ck" CHECK (("api_tokens"."last_used_ip_prefix" is null or length("api_tokens"."last_used_ip_prefix") between 9 and 64)
        and ("api_tokens"."last_used_user_agent" is null or length("api_tokens"."last_used_user_agent") between 1 and 120));