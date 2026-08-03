import { DiagnosisCode } from "../diagnosis/codes";
import { getPublicSuffix } from "../psl";
import { Rcode, RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";

/**
 * Two DNSSEC states that look identical from the outside and need opposite
 * remedies.
 *
 * A zone whose signatures do not verify SERVFAILs to a validating resolver and
 * resolves perfectly everywhere else — so roughly half the internet cannot reach
 * it and the owner sees nothing wrong. A zone that is signed but whose parent
 * publishes no DS is *insecure*: it resolves fine for everyone, and the
 * signatures protect nothing.
 *
 * Confusing them sends someone to fix the wrong thing. Bogus means re-sign or
 * roll back; insecure island means publish the DS at the registrar. Reporting
 * one as the other is worse than reporting neither.
 */

/**
 * Was a SERVFAIL caused by validation, or by the zone being unreachable?
 *
 * With one resolver the answer comes from the CD (Checking Disabled) bit: ask
 * again with validation switched off, and if the answer arrives, the signatures
 * are what failed. `dig +cd` is the same technique.
 *
 * This is why a second, permissive resolver is not required — the fixture tier
 * has one, and reaching for it here would make a diagnosis depend on
 * infrastructure that a library consumer querying `1.1.1.1` does not have.
 */
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

  // Still failing without validation: the zone is genuinely unreachable, which
  // is somebody else's outage and not a DNSSEC finding. Saying nothing is
  // correct — `indeterminate` is already the verdict this produces.
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

/**
 * A delegation left unsigned beneath a parent its owner signed.
 *
 * The guard below is the whole reason this is shippable. The registry's contract
 * — "this delegation is unsigned beneath a signed parent" — is satisfied by every
 * unsigned domain under `.com`, which is signed. Reported literally it is a
 * warning on most of the internet, and a checker that finds something on every
 * domain is one nobody reads. It fired on the clean customer.test fixture the
 * first time this was written.
 *
 * It becomes a real finding one level down: a subdomain somebody delegated
 * without a DS beneath a zone they signed themselves. They went to the trouble
 * and the child did not inherit it — which is also exactly the shape of the
 * delegation product in Phase 3.
 *
 * Never DNSSEC_BOGUS. An island resolves for everybody, nothing is broken today,
 * and the fix is a DS at the registrar rather than anything in the zone.
 */
export async function reportInsecureIsland(
  context: EvaluationContext,
  domain: string
): Promise<void> {
  const labels = domain.split(".");

  if (labels.length < 3) {
    // An org domain at best, whose parent is a public suffix. The guard below
    // would reject it anyway; this just avoids two lookups to learn that.
    return;
  }

  const parent = labels.slice(1).join(".");

  // The guard. A parent that *is* a public suffix is a registry rather than
  // somebody who chose to sign their zone, and its children inherit no
  // expectation from it being signed.
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
    // Signed and vouched for. Nothing to say.
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
    // Unsigned beneath unsigned is the normal state of most of the internet.
    return;
  }

  context.report(DiagnosisCode.DNSSEC_INSECURE_ISLAND, {
    detail: `${parent} is signed and publishes no DS for this delegation, so DNSSEC protection stops at the boundary; nothing is broken today, and the fix is a DS record at the registrar rather than anything in the zone`,
    name: domain,
    observed: `no DS for ${domain}, and ${parent} publishes DNSKEY records`,
  });
}
