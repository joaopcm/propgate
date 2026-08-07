import {
  DIAGNOSIS_REGISTRY,
  type DiagnosisDefinition,
  NOT_LOCALLY_REPRODUCIBLE,
} from "@propgate/dns";
import { FIXTURE_EXPECTATIONS } from "@propgate/dns-fixtures";

/**
 * The published taxonomy, assembled from the same two sources the test suite
 * reads: `DIAGNOSIS_REGISTRY` in `@propgate/dns` and `FIXTURE_EXPECTATIONS` in
 * `@propgate/dns-fixtures`.
 *
 * That is the whole point. Documentation written by hand drifts from the code
 * it describes; documentation generated from the test matrix cannot, and
 * "which fixture proves this?" becomes answerable from a public page rather
 * than from a repository checkout.
 *
 * The slug is load-bearing beyond navigation: the API and the CLI put it on
 * every finding precisely so a consumer can link here without knowing anything
 * about our taxonomy. A duplicate slug would collide as a route and silently
 * hide one code, which is why there is a test for it.
 */

export interface Fixture {
  /** Why the fixture exists, in the words of the fixture table. */
  readonly reason: string;
  readonly zone: string;
}

export interface Entry {
  readonly definition: DiagnosisDefinition;
  readonly fixtures: readonly Fixture[];
  /** Set when no local fixture can produce this, with the written reason. */
  readonly unreproducible: string | undefined;
}

export interface Family {
  /** One line on what this group of codes is about. */
  readonly blurb: string;
  readonly entries: readonly Entry[];
  readonly id: string;
  readonly title: string;
}

const FAMILIES: ReadonlyArray<{
  blurb: string;
  id: string;
  prefixes: readonly string[];
  title: string;
}> = [
  {
    blurb:
      "Which hosts may send as a domain, and whether the record stays inside the ten DNS lookups receivers allow.",
    id: "spf",
    prefixes: ["SPF_"],
    title: "SPF",
  },
  {
    blurb:
      "Whether the signing keys are published, parseable, and strong enough.",
    id: "dkim",
    prefixes: ["DKIM_"],
    title: "DKIM",
  },
  {
    blurb:
      "What receivers should do with a message that fails, and whether the reports go anywhere.",
    id: "dmarc",
    prefixes: ["DMARC_"],
    title: "DMARC",
  },
  {
    blurb: "Where mail for the domain goes, and whether it can arrive at all.",
    id: "mx",
    prefixes: ["MX_"],
    title: "Mail delivery",
  },
  {
    blurb:
      "Whether every nameserver answers, agrees, and serves the zone it was delegated.",
    id: "delegation",
    prefixes: ["NS_"],
    title: "Nameservers",
  },
  {
    blurb: "Which certificate authorities may issue for the name.",
    id: "caa",
    prefixes: ["CAA_"],
    title: "Certificates",
  },
  {
    blurb:
      "Whether a token you minted is published where you asked for it. The proof that a customer controls the zone, and the one check with nothing to parse.",
    id: "ownership",
    prefixes: ["OWNERSHIP_"],
    title: "Ownership",
  },
  {
    blurb:
      "Whether an alias points at the host you issued — including when a provider resolved it away and left address records in its place.",
    id: "cname",
    prefixes: ["CNAME_"],
    title: "Custom subdomains",
  },
  {
    blurb:
      "Faults in how the answer arrived rather than in what it said — truncation, negative caching, DNSSEC state.",
    id: "resolution",
    prefixes: [
      "ANSWER_",
      "DNSSEC_",
      "MULTIPLE_",
      "NEGATIVE_",
      "NODATA_",
      "RRSET_",
      "TCP_",
      "TRUNCATED_",
      "TXT_",
      "WILDCARD_",
    ],
    title: "Resolution",
  },
  {
    blurb:
      "Things a DNS provider did to the record after it was pasted in. Each one turns a support ticket into a sentence.",
    id: "provider",
    prefixes: ["PROVIDER_"],
    title: "Provider behaviour",
  },
];

function fixturesFor(code: string): Fixture[] {
  return FIXTURE_EXPECTATIONS.filter((row) => row.codes.includes(code)).map(
    (row) => ({ reason: row.reason, zone: row.zone })
  );
}

function entryFor(definition: DiagnosisDefinition): Entry {
  return {
    definition,
    fixtures: fixturesFor(definition.code),
    unreproducible: NOT_LOCALLY_REPRODUCIBLE[definition.code],
  };
}

/** Every code, grouped and sorted, with families that have no codes dropped. */
export function families(): Family[] {
  const all = Object.values(DIAGNOSIS_REGISTRY);

  return FAMILIES.map((family) => ({
    blurb: family.blurb,
    entries: all
      .filter((definition) =>
        family.prefixes.some((prefix) => definition.code.startsWith(prefix))
      )
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(entryFor),
    id: family.id,
    title: family.title,
  })).filter((family) => family.entries.length > 0);
}

export function allEntries(): Entry[] {
  return Object.values(DIAGNOSIS_REGISTRY)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(entryFor);
}

export function entryBySlug(slug: string): Entry | undefined {
  const definition = Object.values(DIAGNOSIS_REGISTRY).find(
    (candidate) => candidate.slug === slug
  );

  return definition === undefined ? undefined : entryFor(definition);
}

/**
 * Codes that belong to no family.
 *
 * Exported so a test can assert it is empty: a new code with an unrecognised
 * prefix would otherwise vanish from the index while still being reachable at
 * its own URL, which is the kind of gap nobody notices until a customer follows
 * a link that leads nowhere useful.
 */
export function unfiled(): string[] {
  const filed = new Set(
    families().flatMap((family) =>
      family.entries.map((entry) => entry.definition.code)
    )
  );

  return Object.values(DIAGNOSIS_REGISTRY)
    .map((definition) => definition.code)
    .filter((code) => !filed.has(code));
}
