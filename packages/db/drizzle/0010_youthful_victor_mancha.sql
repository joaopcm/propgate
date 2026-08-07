ALTER TABLE "domains" ADD COLUMN "config_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "expectations" jsonb;