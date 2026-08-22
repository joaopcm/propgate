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
  readonly label?: string;
  readonly requiredPerDomain?: readonly PerDomainField[];
  readonly selector?: string;
  readonly target?: string;
  readonly token?: string;
}

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
