CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"domain_id" text,
	"endpoint_id" text NOT NULL,
	"event" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"tenant_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp,
	"events" text[] DEFAULT '{}' NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"previous_secret" text,
	"previous_secret_expires_at" timestamp,
	"secret" text NOT NULL,
	"tenant_id" text NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_tenant_created_idx" ON "webhook_deliveries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_created_idx" ON "webhook_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_tenant_url_idx" ON "webhook_endpoints" USING btree ("tenant_id","url");