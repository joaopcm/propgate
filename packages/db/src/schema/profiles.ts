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
 * Fields a profile may defer to the domain.
 *
 * A profile is a template many domains pin, and some of what a platform expects
 * is issued per domain: the DKIM key for `acme.com` is not the one for
 * `globex.com`. Naming a field here says the profile states the *shape* and the
 * domain supplies the *value* — without which a tenant with ten thousand domains
 * needs ten thousand profiles and the versioning stops meaning anything.
 *
 * `expectsMail` is deliberately absent: it asserts what the domain is *for*,
 * which is exactly what a profile is. Only fields carrying a value a platform
 * issues per domain belong here.
 */
export const PER_DOMAIN_FIELDS = [
  "caaIssuer",
  "expectedPublicKey",
  "include",
  "selector",
] as const;

export type PerDomainField = (typeof PER_DOMAIN_FIELDS)[number];

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
  /**
   * Fields this requirement takes from the domain instead of from here.
   *
   * A field named here must not also carry a literal value: which one wins is
   * not expressible, so the write is refused. Absence when a field is named is
   * never a pass — the compiled profile comes back `incomplete` and every
   * requirement reads `indeterminate`.
   */
  readonly requiredPerDomain?: readonly PerDomainField[];
  readonly selector?: string;
}

/**
 * Which fields each check kind can defer.
 *
 * Typed against the check union rather than `string`, so adding a seventh check
 * kind fails `tsc` here until somebody decides what it can defer. The zod enum,
 * the validator and the published reference all read this, so none of them can
 * drift from the others.
 */
export const PER_DOMAIN_FIELDS_BY_CHECK: Readonly<
  Record<ProfileRequirement["check"], readonly PerDomainField[]>
> = {
  caa: ["caaIssuer"],
  delegation: [],
  dkim: ["expectedPublicKey", "selector"],
  dmarc: [],
  mx: [],
  spf: ["include"],
};

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
