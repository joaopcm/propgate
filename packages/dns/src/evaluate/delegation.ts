import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";
import { reportBogusIfServfail, reportInsecureIsland } from "./dnssec";
import type { EvaluationResult, Verdict } from "./types";
import { verdictFromFindings, worstVerdict } from "./types";

const RCODE_SERVFAIL = 2;
const RCODE_REFUSED = 5;
const TRAILING_DOT = /\.$/;

const MINIMUM_NAMESERVERS = 2;

export interface DelegationCheck {
  readonly domain: string;
}

interface Nameserver {
  readonly address: ServerAddress | undefined;
  readonly name: string;
}

interface Probe {
  readonly authoritative: boolean;
  readonly nameserver: Nameserver;
  readonly reachable: boolean;
  readonly serial: number | undefined;
}

function normalise(name: string): string {
  return name.trim().replace(TRAILING_DOT, "").toLowerCase();
}

export function parentOf(domain: string): string | null {
  const labels = normalise(domain).split(".").filter(Boolean);

  return labels.length > 1 ? labels.slice(1).join(".") : null;
}

function namesFrom(records: ReturnType<typeof recordsOfType<"NS">>): string[] {
  return records.map((record) => normalise(record.rdata.target));
}

async function addressOf(
  context: EvaluationContext,
  name: string,
  glue: ReadonlyMap<string, string>,
  purpose: string
): Promise<ServerAddress | undefined> {
  const glued = glue.get(name);

  if (glued !== undefined) {
    return { address: glued, port: 53 };
  }

  const outcome = await context.lookup({ name, purpose, type: RecordType.A });

  if (outcome.status !== "answered") {
    return;
  }

  const [record] = recordsOfType(outcome.message.answers, "A");
  const address = record?.rdata.address;

  return address === undefined ? undefined : { address, port: 53 };
}

function glueFrom(
  outcome: Awaited<ReturnType<EvaluationContext["lookup"]>>
): Map<string, string> {
  const glue = new Map<string, string>();

  if (outcome.status !== "answered") {
    return glue;
  }

  for (const record of recordsOfType(outcome.message.additional, "A")) {
    glue.set(normalise(record.name), record.rdata.address);
  }

  return glue;
}

interface Delegation {
  readonly glue: ReadonlyMap<string, string>;
  readonly names: readonly string[];
}

async function parentDelegation(
  context: EvaluationContext,
  domain: string
): Promise<Delegation | undefined> {
  const parent = parentOf(domain);

  if (parent === null) {
    return;
  }

  const parentNs = await context.lookup({
    name: parent,
    purpose: `the nameservers of ${parent}, to ask them how ${domain} is delegated`,
    type: RecordType.NS,
  });

  if (parentNs.status !== "answered") {
    return;
  }

  const parentNames = namesFrom(recordsOfType(parentNs.message.answers, "NS"));
  const parentGlue = glueFrom(parentNs);
  const [first] = parentNames;

  if (first === undefined) {
    return;
  }

  const target = await addressOf(
    context,
    first,
    parentGlue,
    `an address for ${first}, a nameserver of ${parent}`
  );

  if (target === undefined) {
    return;
  }

  const referral = await context.lookup({
    name: domain,
    purpose: `how ${parent} delegates ${domain}`,
    recursionDesired: false,
    target,
    type: RecordType.NS,
  });

  if (referral.status !== "answered") {
    return;
  }

  const authority = namesFrom(recordsOfType(referral.message.authority, "NS"));
  const answer = namesFrom(recordsOfType(referral.message.answers, "NS"));

  return {
    glue: glueFrom(referral),
    names: authority.length > 0 ? authority : answer,
  };
}

async function childNameservers(
  context: EvaluationContext,
  domain: string
): Promise<readonly string[] | undefined> {
  const outcome = await context.lookup({
    name: domain,
    purpose: `the NS records ${domain} publishes about itself`,
    type: RecordType.NS,
  });

  if (outcome.status !== "answered" || outcome.message.rcode !== 0) {
    return;
  }

  return namesFrom(recordsOfType(outcome.message.answers, "NS"));
}

async function probe(
  context: EvaluationContext,
  domain: string,
  nameserver: Nameserver
): Promise<Probe> {
  if (nameserver.address === undefined) {
    return {
      authoritative: false,
      nameserver,
      reachable: false,
      serial: undefined,
    };
  }

  const outcome = await context.lookup({
    name: domain,
    purpose: `whether ${nameserver.name} is authoritative for ${domain}`,
    recursionDesired: false,
    target: nameserver.address,
    type: RecordType.SOA,
  });

  if (outcome.status !== "answered") {
    return {
      authoritative: false,
      nameserver,
      reachable: false,
      serial: undefined,
    };
  }

  if (
    outcome.message.rcode === RCODE_REFUSED ||
    outcome.message.rcode === RCODE_SERVFAIL
  ) {
    return {
      authoritative: false,
      nameserver,
      reachable: true,
      serial: undefined,
    };
  }

  const [soa] = recordsOfType(outcome.message.answers, "SOA");

  return {
    authoritative: outcome.message.flags.aa && soa !== undefined,
    nameserver,
    reachable: true,
    serial: soa?.rdata.serial,
  };
}

function reportLameness(
  context: EvaluationContext,
  domain: string,
  probes: readonly Probe[]
): void {
  const lame = probes.filter((p) => p.reachable && !p.authoritative);
  const unreachable = probes.filter((p) => !p.reachable);

  for (const result of lame) {
    context.report(DiagnosisCode.NS_DELEGATION_LAME, {
      detail:
        "resolvers that happen to pick this server get SERVFAIL while everyone else is fine, so the domain looks intermittently broken rather than broken",
      name: domain,
      observed: result.nameserver.name,
    });
  }

  if (unreachable.length > 0 && unreachable.length === probes.length) {
    context.report(DiagnosisCode.NS_ALL_UNREACHABLE, {
      detail:
        "no delegated nameserver answered, so nothing about this domain resolves for anyone",
      name: domain,
      observed: unreachable.map((p) => p.nameserver.name).join(", "),
    });
    return;
  }

  for (const result of unreachable) {
    context.report(DiagnosisCode.NS_UNREACHABLE, {
      detail:
        "the domain still resolves through its other nameservers, so this is invisible until one of those goes too",
      name: domain,
      observed: result.nameserver.name,
    });
  }
}

function reportSerials(
  context: EvaluationContext,
  domain: string,
  probes: readonly Probe[]
): void {
  const serials = new Map<number, string[]>();

  for (const result of probes) {
    if (result.serial === undefined) {
      continue;
    }

    const names = serials.get(result.serial) ?? [];

    names.push(result.nameserver.name);
    serials.set(result.serial, names);
  }

  if (serials.size < 2) {
    return;
  }

  const described = [...serials.entries()]
    .map(([serial, names]) => `${names.join(", ")} at ${serial}`)
    .join("; ");

  context.report(DiagnosisCode.NS_SERIAL_MISMATCH, {
    detail:
      "a zone transfer has stopped: every answer is valid, some are simply older, and which one a customer sees depends on which server they reach",
    name: domain,
    observed: described,
  });
}

function reportSetMismatch(
  context: EvaluationContext,
  domain: string,
  parent: readonly string[],
  child: readonly string[]
): void {
  const missingAtChild = parent.filter((name) => !child.includes(name));
  const missingAtParent = child.filter((name) => !parent.includes(name));

  if (missingAtChild.length === 0 && missingAtParent.length === 0) {
    return;
  }

  const parts: string[] = [];

  if (missingAtParent.length > 0) {
    parts.push(
      `${missingAtParent.join(", ")} only in the zone's own NS records, so no resolver is sent there`
    );
  }

  if (missingAtChild.length > 0) {
    parts.push(
      `${missingAtChild.join(", ")} only in the parent's delegation, so resolvers are sent to a server the zone does not claim`
    );
  }

  context.report(DiagnosisCode.NS_PARENT_CHILD_MISMATCH, {
    detail: parts.join("; "),
    expected: parent.join(", "),
    name: domain,
    observed: child.join(", "),
  });
}

async function resolveAll(
  context: EvaluationContext,
  names: readonly string[],
  glue: ReadonlyMap<string, string>
): Promise<Nameserver[]> {
  return await Promise.all(
    names.map(async (name) => ({
      address: await addressOf(
        context,
        name,
        glue,
        `an address for the nameserver ${name}`
      ),
      name,
    }))
  );
}

export async function evaluateDelegation(
  context: EvaluationContext,
  check: DelegationCheck
): Promise<EvaluationResult> {
  const domain = normalise(check.domain);

  const bogus = await reportBogusIfServfail(context, domain, RecordType.SOA);

  if (bogus) {
    return {
      findings: context.findings,
      lookups: context.lookups,
      verdict: "fail",
    };
  }

  await reportInsecureIsland(context, domain);

  const parent = await parentDelegation(context, domain);
  const child = await childNameservers(context, domain);

  const finish = (extra: readonly Verdict[] = []): EvaluationResult => ({
    findings: context.findings,
    lookups: context.lookups,
    verdict: worstVerdict([verdictFromFindings(context.findings), ...extra]),
  });

  if (parent === undefined && child === undefined) {
    return finish(["indeterminate"]);
  }

  const delegated = parent?.names ?? child ?? [];

  if (delegated.length === 0) {
    context.report(DiagnosisCode.NS_RECORDS_MISSING, {
      detail:
        "no delegation at the parent and no NS records at the zone, so nothing under this name resolves",
      name: domain,
    });
    return finish();
  }

  if (parent !== undefined && child !== undefined) {
    reportSetMismatch(context, domain, parent.names, child);
  }

  if (delegated.length < MINIMUM_NAMESERVERS) {
    context.report(DiagnosisCode.NS_SINGLE_NAMESERVER, {
      detail:
        "RFC 1034 §4.1 asks for at least two, on separate infrastructure: one server is one maintenance window away from the domain disappearing",
      name: domain,
      observed: delegated.join(", "),
    });
  }

  const nameservers = await resolveAll(
    context,
    delegated,
    parent?.glue ?? new Map()
  );
  const probes = await Promise.all(
    nameservers.map((nameserver) => probe(context, domain, nameserver))
  );

  reportLameness(context, domain, probes);
  reportSerials(context, domain, probes);

  const blind = probes.every((p) => !p.reachable);

  return finish(blind ? ["indeterminate"] : []);
}
