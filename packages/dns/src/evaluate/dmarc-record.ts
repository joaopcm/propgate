/**
 * DMARC policy record parsing (RFC 7489 §6.3).
 *
 * Pure: takes the TXT value, returns what it means. No DNS, so every case here
 * is a unit test.
 */

export type DmarcPolicy = "none" | "quarantine" | "reject";
export type DmarcAlignment = "r" | "s";

export interface DmarcReportUri {
  /** As published, e.g. "mailto:dmarc@example.com!10m". */
  readonly raw: string;
  readonly scheme: string;
  /** The optional `!size` suffix, e.g. "10m". */
  readonly sizeLimit: string | undefined;
  /** The address or endpoint, with any size limit stripped. */
  readonly target: string;
}

export interface DmarcRecord {
  readonly aggregateReportUris: readonly DmarcReportUri[];
  readonly dkimAlignment: DmarcAlignment;
  readonly forensicReportUris: readonly DmarcReportUri[];
  /** Percentage of messages the policy applies to. Defaults to 100. */
  readonly percent: number;
  /** Absent is legal at a subdomain record; required at the org domain. */
  readonly policy: DmarcPolicy | undefined;
  readonly spfAlignment: DmarcAlignment;
  /** Policy for subdomains. Only consulted when the record was found at the org domain. */
  readonly subdomainPolicy: DmarcPolicy | undefined;
  readonly tags: Readonly<Record<string, string | undefined>>;
  readonly version: string;
}

export type DmarcParseIssue =
  | "not-dmarc"
  | "version-not-first"
  | "missing-policy"
  | "invalid-policy"
  | "invalid-percent"
  | "invalid-alignment"
  | "duplicate-tag";

export type DmarcParseResult =
  | { readonly ok: true; readonly record: DmarcRecord }
  | {
      readonly ok: false;
      readonly issue: DmarcParseIssue;
      readonly detail: string;
    };

const POLICIES = new Set<string>(["none", "quarantine", "reject"]);
const MAX_PERCENT = 100;
const URI_SIZE_LIMIT = /!([0-9]+[kmgt]?)$/i;
const DIGITS_ONLY = /^[0-9]+$/;
const DMARC_PREFIX = /^\s*v\s*=\s*DMARC1\s*(;|$)/i;

/**
 * Whether a TXT value is a DMARC record at all.
 *
 * RFC 7489 §6.6.3 discards records that do not begin with `v=DMARC1` before the
 * "is there exactly one record" check. That ordering matters: a domain with one
 * DMARC record and one unrelated TXT has a valid policy, not an ambiguous one.
 */
export function looksLikeDmarc(value: string): boolean {
  return DMARC_PREFIX.test(value);
}

function parseUriList(raw: string | undefined): DmarcReportUri[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }

  const uris: DmarcReportUri[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const sizeMatch = trimmed.match(URI_SIZE_LIMIT);
    const withoutSize = sizeMatch
      ? trimmed.slice(0, trimmed.length - sizeMatch[0].length)
      : trimmed;
    const colon = withoutSize.indexOf(":");

    uris.push({
      raw: trimmed,
      scheme: colon === -1 ? "" : withoutSize.slice(0, colon).toLowerCase(),
      sizeLimit: sizeMatch?.[1],
      target: colon === -1 ? withoutSize : withoutSize.slice(colon + 1),
    });
  }

  return uris;
}

function parseAlignment(
  raw: string | undefined
): DmarcAlignment | "invalid" | undefined {
  if (raw === undefined) {
    return;
  }

  const lowered = raw.toLowerCase();

  if (lowered === "r" || lowered === "s") {
    return lowered;
  }

  return "invalid";
}

interface TagScan {
  readonly order: string[];
  readonly tags: Record<string, string | undefined>;
}

/** Scan the tag-value list. Split out so parseDmarcRecord stays readable. */
function scanTags(value: string): TagScan | { readonly duplicate: string } {
  const tags: Record<string, string | undefined> = {};
  const order: string[] = [];

  for (const pair of value.split(";")) {
    const trimmed = pair.trim();
    const equals = trimmed.indexOf("=");

    if (trimmed.length === 0 || equals === -1) {
      continue;
    }

    const name = trimmed.slice(0, equals).trim().toLowerCase();

    if (name.length === 0) {
      continue;
    }

    if (name in tags) {
      return { duplicate: name };
    }

    tags[name] = trimmed.slice(equals + 1).trim();
    order.push(name);
  }

  return { order, tags };
}

export function parseDmarcRecord(value: string): DmarcParseResult {
  if (!looksLikeDmarc(value)) {
    return {
      detail: "does not begin with v=DMARC1",
      issue: "not-dmarc",
      ok: false,
    };
  }

  const scanned = scanTags(value);

  if ("duplicate" in scanned) {
    return {
      detail: `tag "${scanned.duplicate}" appears more than once`,
      issue: "duplicate-tag",
      ok: false,
    };
  }

  const { tags, order } = scanned;

  // RFC 7489 §6.3: "the "v" tag MUST be the first tag in the list".
  if (order[0] !== "v") {
    return {
      detail: `v= appears after ${order[0]}=`,
      issue: "version-not-first",
      ok: false,
    };
  }

  const policy = tags.p?.toLowerCase();

  if (policy !== undefined && !POLICIES.has(policy)) {
    return {
      detail: `p=${tags.p}, expected none, quarantine, or reject`,
      issue: "invalid-policy",
      ok: false,
    };
  }

  const subdomainPolicy = tags.sp?.toLowerCase();

  if (subdomainPolicy !== undefined && !POLICIES.has(subdomainPolicy)) {
    return {
      detail: `sp=${tags.sp}, expected none, quarantine, or reject`,
      issue: "invalid-policy",
      ok: false,
    };
  }

  const dkimAlignment = parseAlignment(tags.adkim);
  const spfAlignment = parseAlignment(tags.aspf);

  if (dkimAlignment === "invalid" || spfAlignment === "invalid") {
    return {
      detail: `alignment must be r or s; got adkim=${tags.adkim ?? "r"} aspf=${tags.aspf ?? "r"}`,
      issue: "invalid-alignment",
      ok: false,
    };
  }

  let percent = MAX_PERCENT;

  if (tags.pct !== undefined) {
    if (!DIGITS_ONLY.test(tags.pct)) {
      return {
        detail: `pct=${tags.pct} is not a number`,
        issue: "invalid-percent",
        ok: false,
      };
    }

    percent = Number.parseInt(tags.pct, 10);

    if (percent > MAX_PERCENT) {
      return {
        detail: `pct=${percent} is above 100`,
        issue: "invalid-percent",
        ok: false,
      };
    }
  }

  return {
    ok: true,
    record: {
      aggregateReportUris: parseUriList(tags.rua),
      // RFC 7489 §6.3: both alignment modes default to relaxed.
      dkimAlignment: dkimAlignment ?? "r",
      forensicReportUris: parseUriList(tags.ruf),
      percent,
      policy: policy as DmarcPolicy | undefined,
      spfAlignment: spfAlignment ?? "r",
      subdomainPolicy: subdomainPolicy as DmarcPolicy | undefined,
      tags,
      version: "DMARC1",
    },
  };
}

/**
 * The policy that actually applies to `domain`.
 *
 * `sp=` governs subdomains only when the record was discovered at the
 * organizational domain. A subdomain publishing its own record is authoritative
 * for itself, and its `p=` wins — which is the discovery rule stated from the
 * other direction.
 */
export function effectivePolicy(
  record: DmarcRecord,
  discoveredAt: "exact" | "organizational"
): DmarcPolicy | undefined {
  if (
    discoveredAt === "organizational" &&
    record.subdomainPolicy !== undefined
  ) {
    return record.subdomainPolicy;
  }

  return record.policy;
}
