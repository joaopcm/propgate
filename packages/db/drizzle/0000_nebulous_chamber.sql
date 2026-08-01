CREATE TABLE "api_keys" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"hashed_key" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_used_at" timestamp,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"revoked_at" timestamp,
	"tenant_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hashed_key_idx" ON "api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");