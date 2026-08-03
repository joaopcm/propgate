import { DiagnosisCode } from "../diagnosis/codes";
import { Rcode } from "../wire/constants";
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
