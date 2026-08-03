import { randomBytes } from "node:crypto";
import { RecordType } from "../wire/constants";
import type { EvaluationContext } from "./context";

/**
 * Does this zone answer for names nobody published?
 *
 * A wildcard makes every lookup succeed, so a check that asks "did the record
 * come back?" passes for a customer who configured nothing at all. That is the
 * one failure mode worse than having no product: a false pass, which the partner
 * acts on.
 *
 * Detection is behavioural — ask for a name no one would ever publish and see
 * whether the zone answers anyway. One lookup, and it belongs above the
 * evaluators rather than inside one:
 *
 *  - it is a fact about the **zone**, not about any single record, so probing
 *    per evaluator would ask the same question three times;
 *  - and it would be asked once per DKIM *selector*, which is the check most
 *    likely to have several.
 *
 * The other detection path is free and narrower: on a signed zone, an RRSIG's
 * `Labels` field is smaller than the answering name's label count exactly when
 * the answer was synthesised. It needs no probe but only works with DNSSEC and
 * DO set, so it is an optimisation on top of this rather than a replacement.
 * `wildcard-signed.test` is waiting for it.
 */

/**
 * A label no zone would publish, and random per probe rather than fixed.
 *
 * A constant would be cacheable by anyone who wanted a domain to look clean:
 * publish that one name and the probe stops working. Sixteen hex characters of
 * CSPRNG output cannot be pre-empted, and the name is short enough to leave
 * room under the 253-byte limit for the domain it is prefixed to.
 */
function unpublishableLabel(): string {
  return `_pg-probe-${randomBytes(8).toString("hex")}`;
}

export interface WildcardProbe {
  /** The name asked for, so the derivation shows what was concluded from what. */
  readonly probed: string;
  /**
   * Whether the zone answered a name nobody published.
   *
   * `false` also covers "we could not tell" — a probe that timed out says
   * nothing about wildcards, and guessing here would turn an unreachable
   * resolver into an accusation about a customer's zone.
   */
  readonly synthesises: boolean;
}

export async function probeWildcard(
  context: EvaluationContext,
  domain: string
): Promise<WildcardProbe> {
  const probed = `${unpublishableLabel()}.${domain}`;

  const outcome = await context.lookup({
    name: probed,
    purpose: "probing a name nobody published, to detect wildcard synthesis",
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    return { probed, synthesises: false };
  }

  return {
    // Any answer record at all is the signal. A wildcard that matched produced
    // it, because nothing else could have.
    probed,
    synthesises: outcome.message.answers.length > 0,
  };
}
