CREATE TABLE "tenant_members" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "request_quota_per_second" integer;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_email_idx" ON "tenant_members" USING btree ("email");