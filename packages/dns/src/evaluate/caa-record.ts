import type { RdataCAA } from "../wire/rdata";

/**
 * CAA property semantics (RFC 8659 §4).
 *
 * Pure: takes a decoded CAA RRset, says what it permits. No DNS, so the tree
 * climb lives in the evaluator and everything here is a unit test.
 */

export interface CaaIssuer {
  /** The CA's domain, lowercased. Empty means the deny-all form. */
  readonly domain: string;
  /** Parameters after the first semicolon, e.g. accounturi, validationmethods. */
  readonly parameters: Readonly<Record<string, string | undefined>>;
  /** The property value exactly as published. */
  readonly raw: string;
}

export interface CaaPolicy {
  readonly iodef: readonly string[];
  /** `issue` properties. Governs non-wildcard issuance. */
  readonly issue: readonly CaaIssuer[];
  /**
   * `issuewild` properties. When any exist they govern wildcard issuance on
   * their own; when none exist, wildcards fall back to `issue`.
   */
  readonly issueWild: readonly CaaIssuer[];
  /**
   * Properties we do not recognise that carry the critical bit.
   *
   * RFC 8659 §4.1: a CA that does not understand a critical property MUST NOT
   * issue. So an unknown critical property blocks issuance entirely, which is a
   * far more consequential finding than an unknown tag normally sounds.
   */
  readonly unknownCritical: readonly string[];
}

/**
 * Split an issue/issuewild value into its CA domain and parameters.
 *
 * RFC 8659 §4.2: the value is an issuer-domain-name optionally followed by
 * `;key=value` pairs. An empty issuer-domain-name — the `;` form — means no CA
 * is authorised, which is the deny-all this whole record type exists to express.
 */
export function parseCaaIssuer(raw: string): CaaIssuer {
  const semicolon = raw.indexOf(";");
  const domain = (semicolon === -1 ? raw : raw.slice(0, semicolon))
    .trim()
    .toLowerCase();

  const parameters: Record<string, string | undefined> = {};

  if (semicolon !== -1) {
    for (const part of raw.slice(semicolon + 1).split(";")) {
      const equals = part.indexOf("=");

      if (equals === -1) {
        continue;
      }

      const key = part.slice(0, equals).trim().toLowerCase();

      if (key.length > 0) {
        parameters[key] = part.slice(equals + 1).trim();
      }
    }
  }

  return { domain, parameters, raw };
}

/** Whether this property forbids all issuance rather than naming a CA. */
export function isDenyAll(issuer: CaaIssuer): boolean {
  return issuer.domain.length === 0;
}

const KNOWN_TAGS = new Set(["issue", "issuewild", "iodef"]);

export function parseCaaPolicy(records: readonly RdataCAA[]): CaaPolicy {
  const issue: CaaIssuer[] = [];
  const issueWild: CaaIssuer[] = [];
  const iodef: string[] = [];
  const unknownCritical: string[] = [];

  for (const record of records) {
    const tag = record.tag.toLowerCase();

    if (tag === "issue") {
      issue.push(parseCaaIssuer(record.value));
      continue;
    }

    if (tag === "issuewild") {
      issueWild.push(parseCaaIssuer(record.value));
      continue;
    }

    if (tag === "iodef") {
      iodef.push(record.value);
      continue;
    }

    if (!KNOWN_TAGS.has(tag) && record.critical) {
      unknownCritical.push(tag);
    }
  }

  return { iodef, issue, issueWild, unknownCritical };
}

export type CaaDecision =
  | { readonly allowed: true; readonly matched: CaaIssuer | undefined }
  | {
      readonly allowed: false;
      readonly reason: "deny-all" | "not-listed" | "unknown-critical";
      readonly permitted: readonly string[];
    };

/**
 * Whether `issuer` may issue for this name.
 *
 * The properties that apply depend on whether a wildcard is being requested:
 * `issuewild` governs wildcards exclusively when present, and `issue` governs
 * them only when no `issuewild` exists. Merging the two would authorise a CA the
 * domain owner deliberately excluded from wildcards.
 */
export function decideIssuance(
  policy: CaaPolicy,
  issuer: string,
  options: { wildcard?: boolean } = {}
): CaaDecision {
  if (policy.unknownCritical.length > 0) {
    return {
      allowed: false,
      permitted: [],
      reason: "unknown-critical",
    };
  }

  const applicable =
    options.wildcard && policy.issueWild.length > 0
      ? policy.issueWild
      : policy.issue;

  // No applicable property at all means the record set does not restrict this
  // kind of issuance — not that issuance is forbidden.
  if (applicable.length === 0) {
    return { allowed: true, matched: undefined };
  }

  if (applicable.every(isDenyAll)) {
    return { allowed: false, permitted: [], reason: "deny-all" };
  }

  const wanted = issuer.trim().toLowerCase();
  const matched = applicable.find((candidate) => candidate.domain === wanted);

  if (matched) {
    return { allowed: true, matched };
  }

  return {
    allowed: false,
    permitted: applicable.filter((c) => !isDenyAll(c)).map((c) => c.domain),
    reason: "not-listed",
  };
}
