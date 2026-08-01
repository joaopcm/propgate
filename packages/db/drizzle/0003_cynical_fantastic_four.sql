CREATE TABLE "record_changes" (
	"current" text,
	"domain_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"previous" text,
	"requirement_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_changes" ADD CONSTRAINT "record_changes_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_changes_domain_observed_idx" ON "record_changes" USING btree ("domain_id","observed_at");