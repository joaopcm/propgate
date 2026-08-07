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
  "label",
  "selector",
  "target",
  "token",
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
  readonly check:
    | "caa"
    | "cname"
    | "delegation"
    | "dkim"
    | "dmarc"
    | "mx"
    | "ownership"
    | "spf";
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  /**
   * The label the record goes at, e.g. `_pg-challenge`, `track` or `send`.
   *
   * Shared by `ownership`, `cname`, `spf` and `mx` because it means the same
   * thing in all four: the part of the name before the domain. Required for an
   * alias, which RFC 1034 §3.6.2 forbids at an apex; optional everywhere else,
   * where absent means the apex.
   *
   * On `spf` and `mx` it is what makes a return-path host expressible. Every
   * sending platform publishes SPF twice — at the apex for the From domain, and
   * at a bounce host like `send` for the envelope sender receivers actually
   * check — and asserts opposite things about MX at the two names. Without a
   * label those are two domains to register and two states to reconcile for what
   * a customer thinks of as one.
   *
   * Usually a profile literal — a platform picks one name and every customer
   * uses it. Deferrable anyway, because the ones that embed an account id in the
   * label are exactly the ones with too many domains to version per domain.
   */
  readonly label?: string;
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
  /** The alias target, e.g. `acme.track.propgate.com`. */
  readonly target?: string;
  /** The ownership token, compared byte-for-byte. */
  readonly token?: string;
}

/**
 * Which fields each check kind can defer.
 *
 * Typed against the check union rather than `string`, so adding a check kind
 * fails `tsc` here until somebody decides what it can defer. The zod enum, the
 * validator and the published reference all read this, so none of them can
 * drift from the others.
 *
 * `token` and `target` are the two that most need deferring, and for opposite
 * reasons. A token is *only ever* per-domain — a value minted for one domain and
 * meaningless on another — so a profile that carried one as a literal would be a
 * profile with exactly one domain in it. A target is usually a literal and
 * sometimes not, because a platform that puts the account in the hostname issues
 * a different one to everybody.
 */
export const PER_DOMAIN_FIELDS_BY_CHECK: Readonly<
  Record<ProfileRequirement["check"], readonly PerDomainField[]>
> = {
  caa: ["caaIssuer"],
  cname: ["label", "target"],
  delegation: [],
  dkim: ["expectedPublicKey", "selector"],
  dmarc: [],
  mx: ["label"],
  ownership: ["label", "token"],
  spf: ["include", "label"],
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
