import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { domains } from "./domains";

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
