import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenants } from "./tenants";

/**
 * One requirement of a tenant's record set, with a stable key so a result can
 * be reported against it rather than against a check kind.
 *
 * Deliberately limited to what the evaluators already assert. A requirement
 * nobody can evaluate is a promise the API cannot keep — which is why there is
 * no minimum-DMARC-policy field here even though it is an obvious thing to
 * want: the evaluator reports `p=none` as a warning and cannot assert a floor.
 */
export interface ProfileRequirement {
  readonly caaIssuer?: string;
  readonly check: "caa" | "delegation" | "dkim" | "dmarc" | "mx" | "spf";
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly selector?: string;
}

export interface ProfileDefinition {
  readonly requirements: readonly ProfileRequirement[];
}

/**
 * A profile *version*. Editing a profile writes a new row.
 *
 * Domains pin the version they were registered against, so an edit cannot
 * silently reclassify every domain using it — which in milestone 2 would arrive
 * as a webhook storm with no deploy behind it.
 *
 * The key is unique per tenant rather than globally: it is a tenant's own name
 * for the profile, and the second tenant to want "sending" should be able to
 * have it.
 */
export const profiles = pgTable(
  "profiles",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    definition: jsonb("definition").$type<ProfileDefinition>().notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    key: text("key").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("profiles_tenant_key_version_idx").on(
      table.tenantId,
      table.key,
      table.version
    ),
  ]
);
