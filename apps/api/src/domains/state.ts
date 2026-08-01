import type { DomainState } from "@propgate/db";
import type { Verdict } from "@propgate/dns";
import type { RequirementResult } from "../profiles/compile";

/**
 * What a check does to a domain's state, and what it writes down.
 *
 * Small enough to read in one sitting, which is deliberate: this is where the
 * four-verdict distinction the evaluators, the pipeline, the CLI and the public
 * API all preserve either survives into the product or quietly dies.
 */

/**
 * The next state, or the current one.
 *
 * `indeterminate` is not an edge in this machine. A check that could not
 * complete says nothing about the domain, so the domain keeps whatever it had —
 * a resolver blip must never move a verified domain to failed, and in milestone
 * 2 that same edge is a webhook to a partner's customer.
 *
 * `verifying` and `degraded` are unreachable here. Checks are synchronous
 * within one request so nothing observes the first, and the second needs the
 * hysteresis that arrives with the sweeper.
 */
export function nextState(current: DomainState, verdict: Verdict): DomainState {
  if (verdict === "indeterminate") {
    return current;
  }

  return verdict === "fail" ? "failed" : "verified";
}

/**
 * What was seen for one requirement, as a value that can be compared to the
 * last one.
 *
 * Not the raw record: a requirement is satisfied by a *property* of the zone —
 * "our include is authorised", "this selector publishes a valid key" — and
 * several different record texts satisfy it identically. Comparing texts would
 * append a timeline entry every time a customer reordered their SPF mechanisms.
 *
 * The verdict and the sorted diagnosis codes are exactly the part a partner
 * reacts to, and the codes are a public contract, so a timeline built on them
 * stays readable. Sorted because a set of findings has no inherent order and an
 * accidental reordering is not a change.
 */
export function observationFor(result: RequirementResult): string {
  if (result.findings.length === 0) {
    return result.verdict;
  }

  const codes = [...result.findings.map((finding) => finding.code)].sort();

  return `${result.verdict}:${codes.join(",")}`;
}
