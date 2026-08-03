import type { RequirementResult } from "../profiles/compile";

/**
 * What a check writes down.
 *
 * The state machine itself lives in `hysteresis.ts`, which is where the
 * four-verdict distinction the evaluators, the pipeline, the CLI and the public
 * API all preserve either survives into the product or quietly dies. What is
 * left here is how an observation is compared to the last one.
 */

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
