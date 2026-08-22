import { DiagnosisCode } from "../diagnosis/codes";
import { getPublicSuffix } from "../psl";
import { Rcode, RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";

export async function reportBogusIfServfail(
  context: EvaluationContext,
  name: string,
  type: number
): Promise<boolean> {
  const validated = await context.lookup({
    name,
    purpose: "the zone apex, to establish DNSSEC state",
    type,
  });

  if (
    validated.status !== "answered" ||
    validated.message.rcode !== Rcode.SERVFAIL
  ) {
    return false;
  }

  const permissive = await context.lookup({
    checkingDisabled: true,
    name,
    purpose:
      "the same question with validation disabled, to attribute the SERVFAIL",
    type,
  });

  if (
    permissive.status !== "answered" ||
    permissive.message.rcode !== Rcode.NOERROR
  ) {
    return false;
  }

  context.report(DiagnosisCode.DNSSEC_BOGUS, {
    detail:
      "the answer arrives with DNSSEC validation disabled and fails with it enabled, so the signatures are what is broken; validating resolvers cannot reach this zone at all while everyone else sees it working",
    name,
    observed: "SERVFAIL when validated, NOERROR with checking disabled",
  });

  return true;
}

export async function reportInsecureIsland(
  context: EvaluationContext,
  domain: string
): Promise<void> {
  const labels = domain.split(".");

  if (labels.length < 3) {
    return;
  }

  const parent = labels.slice(1).join(".");

  if (getPublicSuffix(parent) === parent) {
    return;
  }

  const ds = await context.lookup({
    name: domain,
    purpose: "whether this delegation is signed, via the parent's DS",
    type: RecordType.DS,
  });

  if (ds.status !== "answered") {
    return;
  }

  if (recordsOfType(ds.message.answers, "DS").length > 0) {
    return;
  }

  const parentKeys = await context.lookup({
    name: parent,
    purpose: "whether the parent is signed, which is what makes this a gap",
    type: RecordType.DNSKEY,
  });

  if (parentKeys.status !== "answered") {
    return;
  }

  if (recordsOfType(parentKeys.message.answers, "DNSKEY").length === 0) {
    return;
  }

  context.report(DiagnosisCode.DNSSEC_INSECURE_ISLAND, {
    detail: `${parent} is signed and publishes no DS for this delegation, so DNSSEC protection stops at the boundary; nothing is broken today, and the fix is a DS record at the registrar rather than anything in the zone`,
    name: domain,
    observed: `no DS for ${domain}, and ${parent} publishes DNSKEY records`,
  });
}
