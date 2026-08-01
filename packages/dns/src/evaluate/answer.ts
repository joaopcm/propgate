import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";

/**
 * What the *shape* of a negative answer says, as opposed to its absence.
 *
 * "Your record is missing" is where most checkers stop. The answer that carried
 * that absence knows three more things, and each one changes what the customer
 * should do next:
 *
 *  - **NODATA is not NXDOMAIN.** NXDOMAIN means the name does not exist at all;
 *    NODATA means it exists with other record types on it. The second almost
 *    always means the record was published at the wrong name, or as the wrong
 *    type — and telling those apart is the difference between "add the record"
 *    and "look at what you already put there".
 *  - **The negative answer has a lifetime.** RFC 2308 §5 caches it for the
 *    lesser of the SOA minimum and the SOA TTL, so a customer who fixes the
 *    record still sees the old answer for that long. Without this they conclude
 *    the fix did not work and change something else.
 *  - **The answer may have arrived over TCP.** Harmless in itself, and a signal
 *    that the response is near the UDP limit — the point at which a middlebox
 *    that blocks TCP/53 turns an intermittent failure into a permanent one.
 *
 * Reported only where a record was genuinely expected. DKIM's appended-name
 * probe *wants* an NXDOMAIN, and reporting the shape of that would be noise on
 * every healthy domain.
 */

const RCODE_NXDOMAIN = 3;

/** RFC 2308 §5: the negative TTL is the lesser of the SOA minimum and its TTL. */
export function negativeCacheSeconds(
  outcome: QueryOutcome
): number | undefined {
  if (outcome.status !== "answered") {
    return;
  }

  const [soa] = recordsOfType(outcome.message.authority, "SOA");

  return soa === undefined ? undefined : Math.min(soa.rdata.minimum, soa.ttl);
}

/**
 * Above this, a customer fixing a record will conclude the fix did not work.
 *
 * Receipt: the fixture tier's `negcache-low` zone uses 60 seconds, which nobody
 * notices, and the default in most zone templates is 3600. An hour of a wrong
 * answer after a correct edit is the interval that generates support tickets —
 * long enough to be disbelieved, short enough that nobody suspects caching.
 * Fifteen minutes is where it stops being explainable as propagation.
 */
const NEGATIVE_CACHE_WARN_SECONDS = 900;

/**
 * That the answer came over TCP, which is true whether or not it found anything.
 *
 * A record that *was* found this way is the interesting case: it is working
 * today and one middlebox away from not working. Separate from the negative
 * shape below so the found path can report it without claiming an absence.
 */
export function reportTransport(
  context: EvaluationContext,
  outcome: QueryOutcome,
  name: string
): void {
  if (outcome.transport !== "tcp") {
    return;
  }

  context.report(DiagnosisCode.TRUNCATED_FELL_BACK_TO_TCP, {
    detail:
      "the answer did not fit in a UDP packet, so it was fetched over TCP; that works, and it stops working behind a middlebox that blocks TCP port 53",
    name,
  });
}

export function reportAnswerShape(
  context: EvaluationContext,
  outcome: QueryOutcome,
  name: string
): void {
  reportTransport(context, outcome, name);

  if (outcome.status !== "answered") {
    return;
  }

  if (outcome.message.rcode !== RCODE_NXDOMAIN) {
    // NOERROR with nothing of the type asked for. The name exists, so something
    // else is published on it.
    context.report(DiagnosisCode.NODATA_NOT_NXDOMAIN, {
      detail:
        "the name exists and carries other records, so this is a record published at the wrong name or as the wrong type rather than one that was never added",
      name,
    });
  }

  const seconds = negativeCacheSeconds(outcome);

  if (seconds !== undefined && seconds > NEGATIVE_CACHE_WARN_SECONDS) {
    context.report(DiagnosisCode.NEGATIVE_CACHE_LIKELY, {
      detail: `resolvers may remember this absence for ${seconds} seconds after the record is added, so a correct fix will not appear to work until then`,
      name,
      observed: `${seconds}s`,
    });
  }
}
