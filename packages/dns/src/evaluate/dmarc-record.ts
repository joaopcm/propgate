export type DmarcPolicy = "none" | "quarantine" | "reject";
export type DmarcAlignment = "r" | "s";

export interface DmarcReportUri {
  readonly raw: string;
  readonly scheme: string;
  readonly sizeLimit: string | undefined;
  readonly target: string;
}

export interface DmarcRecord {
  readonly aggregateReportUris: readonly DmarcReportUri[];
  readonly dkimAlignment: DmarcAlignment;
  readonly forensicReportUris: readonly DmarcReportUri[];
  readonly percent: number;
  readonly policy: DmarcPolicy | undefined;
  readonly spfAlignment: DmarcAlignment;
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
