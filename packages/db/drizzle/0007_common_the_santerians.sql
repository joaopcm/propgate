CREATE TABLE "otp_codes" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_live_email_idx" ON "otp_codes" USING btree ("email") WHERE "otp_codes"."consumed_at" is null;