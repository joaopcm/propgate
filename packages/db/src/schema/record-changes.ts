import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { domains } from "./domains";

/**
 * Append-only, and appended *only* when an observed value actually differs.
 *
 * Writing a row per check is 360k rows a day at ten thousand domains and turns
 * a $20 bill into a $400 one — invariant 3 in `.claude/CLAUDE.md`. `previous`
 * is null for the first observation of a requirement, which is how "we saw this
 * for the first time" is told apart from "it changed to this".
 */
export const recordChanges = pgTable(
  "record_changes",
  {
    current: text("current"),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    observedAt: timestamp("observed_at").defaultNow().notNull(),
    previous: text("previous"),
    requirementKey: text("requirement_key").notNull(),
  },
  (table) => [
    index("record_changes_domain_observed_idx").on(
      table.domainId,
      table.observedAt
    ),
  ]
);
