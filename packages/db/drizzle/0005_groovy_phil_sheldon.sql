CREATE TABLE "state_transitions" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"domain_id" text NOT NULL,
	"evidence" jsonb,
	"from_state" "domain_state" NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"to_state" "domain_state" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "state_transitions_domain_created_idx" ON "state_transitions" USING btree ("domain_id","created_at");