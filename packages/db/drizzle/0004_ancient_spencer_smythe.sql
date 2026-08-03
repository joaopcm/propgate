ALTER TABLE "domains" ALTER COLUMN "next_check_at" SET DEFAULT now();--> statement-breakpoint
-- Backfill before the NOT NULL. drizzle-kit does not generate this, and the
-- migration cannot do without it: every row that already exists has a null here,
-- because nothing wrote the column until the sweeper arrived. Without this line
-- the next statement fails with `column "next_check_at" of relation "domains"
-- contains null values`, and since migrate gates the deploy, the deploy stops
-- with the schema half applied.
--
-- `now()` rather than a staggered spread: making every existing domain due at
-- once is correct. None of them has ever been swept, the batch limit bounds how
-- many are claimed per tick, and inventing a spread would be a scheduling
-- decision nobody asked for.
UPDATE "domains" SET "next_check_at" = now() WHERE "next_check_at" IS NULL;--> statement-breakpoint
ALTER TABLE "domains" ALTER COLUMN "next_check_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "domains_next_check_at_idx" ON "domains" USING btree ("next_check_at");
