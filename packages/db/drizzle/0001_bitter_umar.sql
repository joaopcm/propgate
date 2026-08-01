CREATE TABLE "profiles" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_tenant_key_version_idx" ON "profiles" USING btree ("tenant_id","key","version");