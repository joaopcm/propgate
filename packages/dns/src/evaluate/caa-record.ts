import type { RdataCAA } from "../wire/rdata";

export interface CaaIssuer {
  readonly domain: string;
  readonly parameters: Readonly<Record<string, string | undefined>>;
  readonly raw: string;
}

export interface CaaPolicy {
  readonly iodef: readonly string[];
  readonly issue: readonly CaaIssuer[];
  readonly issueWild: readonly CaaIssuer[];
  readonly unknownCritical: readonly string[];
}

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
