import type { Question } from "@/lib/quiz/types";

export const QUESTIONS: readonly Question[] = [
  {
    correct: 3,
    explanation:
      "c-ares hands back the answer and discards the response. The TC bit, RRSIGs and the DO bit, the authority-section SOA of an NXDOMAIN, the advertised EDNS buffer, the difference between REFUSED and SERVFAIL, and the AA flag are all unavailable, and each one is load-bearing for at least one diagnosis code.",
    id: "unit2:why-not-node-dns",
    options: [
      "It is too slow for interactive verification",
      "It cannot query over TCP",
      "It has runtime dependencies",
      "It discards the parts of the response every finding depends on, including the TC and AA flags",
    ],
    prompt: "Why can this library not be built on `node:dns`?",
    source: "packages/dns/README.md",
  },
  {
    correct: 1,
    explanation:
      "NODATA has no dedicated response code. It is RCODE 0 with ANCOUNT 0 and a SOA in the authority section: the distinction lives in a count rather than in a status, which is exactly why so much software reports it as 'not found'.",
    id: "unit2:nodata-header",
    options: [
      "RCODE 3 with ANCOUNT 0",
      "RCODE 0 with ANCOUNT 0 and a SOA in the authority section",
      "RCODE 0 with the AA flag clear",
      "RCODE 5 with a SOA in the additional section",
    ],
    prompt: "In the twelve-byte header, what does NODATA look like?",
    source: "packages/dns/src/wire/message.ts",
  },
  {
    correct: 0,
    explanation:
      "A label is capped at 63 bytes by RFC 1035 §2.3.4, which leaves the top two bits of a length byte unused. A length byte with both set is not a length at all: it is the high six bits of a fourteen-bit offset into the message, and the next byte carries the rest.",
    id: "unit2:compression",
    options: [
      "Labels are capped at 63 bytes, leaving the top two bits free to mark a compression pointer",
      "The limit matches the maximum length of a hostname component in email",
      "It keeps every name inside a single UDP datagram",
      "It is the largest value that fits in a signed byte",
    ],
    prompt: "Why are DNS labels limited to 63 bytes rather than 255?",
    source: "packages/dns/src/wire/constants.ts",
  },
  {
    correct: 2,
    explanation:
      "RFC 1035 §4.2.1 caps a UDP response with no OPT record at 512 bytes as a matter of protocol, independent of how the server is configured. That makes omitting EDNS0 the only lever for driving truncation that does not depend on server tuning.",
    id: "unit2:edns-512",
    options: [
      "The server chooses a size and the client cannot influence it",
      "The response is capped at 1232 bytes to avoid fragmentation",
      "The response is capped at 512 bytes by protocol, regardless of server configuration",
      "The response is not capped, but records over 512 bytes are dropped",
    ],
    prompt:
      "What happens to the size limit on a UDP response when the query carries no EDNS0 OPT record?",
    source: "packages/dns/src/wire/constants.ts",
  },
  {
    correct: 1,
    explanation:
      "The DO bit lives in the OPT pseudo-record and asks the server to include DNSSEC records. Without it there are no RRSIGs, so there is no DNSSEC state to read and no wildcard Labels signal either. c-ares cannot set it.",
    id: "unit2:do-bit",
    options: [
      "It asks the resolver to validate signatures on the client's behalf",
      "It asks the server to include RRSIG and other DNSSEC records in the response",
      "It disables DNSSEC validation for this query",
      "It requests a larger UDP buffer",
    ],
    prompt: "What does setting the DO bit do?",
    source: "packages/dns/README.md",
  },
  {
    correct: 2,
    explanation:
      "A server named in a parent's delegation that answers without the AA flag does not believe it is authoritative for the zone. That is a lame delegation, and it is a different problem from a server that never answers at all: different owner, different fix.",
    id: "unit2:lame",
    options: [
      "The server timed out",
      "The zone is unsigned",
      "A server named in the delegation answered without the AA flag set",
      "The parent and the child publish different NS records",
    ],
    prompt: "What is a lame delegation, on the wire?",
    source: "packages/dns/src/evaluate/delegation.ts",
  },
  {
    correct: 0,
    explanation:
      "Hardcoding 53 means a test tier on high ports needs a shim between the resolver and the socket, so the thing under test stops being the thing that ships. The fixture tier instead runs six servers on distinct loopback addresses, all on real port 53, so following a delegation needs no special case.",
    id: "unit2:port-field",
    options: [
      "So the fixture tier can serve real port 53 on distinct addresses and delegation-following needs no shim",
      "Because some registrars publish nameservers on non-standard ports",
      "To support DNS over HTTPS",
      "Because the port is part of the glue record format",
    ],
    prompt:
      "Why is a nameserver's port a field on the address type rather than the constant 53?",
    source: "packages/dns/src/types.ts",
  },
  {
    correct: 3,
    explanation:
      "SPF's ten-lookup limit applies per evaluation and has to survive recursive include: expansion, so the counter cannot live inside a single evaluator. The context also carries a whole-evaluation deadline and records why each lookup happened, which is what lets a verdict show its working.",
    id: "unit2:context",
    options: [
      "To cache answers between evaluators",
      "To retry failed queries with a different transport",
      "To keep the transport layer free of DNSSEC logic",
      "To hold a lookup budget, a deadline, and the record of why each lookup happened, all of which span evaluators",
    ],
    prompt:
      "Why do evaluators go through an evaluation context instead of calling the transport directly?",
    source: "packages/dns/src/evaluate/context.ts",
  },
  {
    correct: 1,
    explanation:
      "It is a tripwire, deliberately set far above what any real domain uses. A good domain never comes close; if a legitimate one ever did, the number would be wrong and would need re-measuring rather than working around.",
    id: "unit2:tripwire",
    options: [
      "It is the maximum a single UDP datagram can carry",
      "It is a tripwire set far past where any good domain goes, not a throughput target",
      "It is the SPF lookup limit multiplied by five",
      "It was measured as the 99th percentile of real checks",
    ],
    prompt:
      "The default cap on total lookups for one evaluation is generous rather than tight. What is it for?",
    source: "packages/dns/src/evaluate/context.ts",
  },
];
