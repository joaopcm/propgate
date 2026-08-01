CREATE TYPE "public"."domain_state" AS ENUM('pending', 'verifying', 'verified', 'degraded', 'failed');--> statement-breakpoint
CREATE TABLE "domains" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"external_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"last_checked_at" timestamp,
	"last_result" jsonb,
	"name" text NOT NULL,
	"next_check_at" timestamp,
	"profile_version_id" text NOT NULL,
	"state" "domain_state" DEFAULT 'pending' NOT NULL,
	"tenant_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_profile_version_id_profiles_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_tenant_name_idx" ON "domains" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_tenant_external_id_idx" ON "domains" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE INDEX "domains_state_next_check_at_idx" ON "domains" USING btree ("state","next_check_at");