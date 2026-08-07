import type { CheckKind } from "@propgate/dns";
import type { EvaluatorEntry } from "@/lib/api";
import {
  CAA_SAMPLE,
  CNAME_SAMPLE,
  DELEGATION_SAMPLE,
  DKIM_SAMPLE,
  DMARC_SAMPLE,
  MX_SAMPLE,
  OWNERSHIP_SAMPLE,
  SPF_SAMPLE,
} from "./_snippets";

/**
 * What each evaluator is, and the part of it a reader would get wrong.
 *
 * Here rather than in the page because MDX is parsed as plain JavaScript: a
 * type annotation or a `import type` in a `.mdx` file is a syntax error, so a
 * table declared there cannot be keyed by `CheckKind` and cannot be checked
 * against it. Two check kinds shipped while this lived in the page; it still
 * compiled, and died at prerender reading `nonObvious` of `undefined`.
 *
 * `Record<CheckKind, …>` is the whole point of the move. A ninth kind now
 * fails `tsc --noEmit`, which CI already runs, instead of `next build`.
 */
export const EVALUATOR_ENTRIES: Record<CheckKind, EvaluatorEntry> = {
  caa: {
    code: CAA_SAMPLE,
    nonObvious:
      "the climb goes to the top-level domain, never to the organizational domain (the Public Suffix List plays no part), and stops at the first CAA RRset it finds. A parent's policy is replaced by a nearer one, never merged with it.",
  },
  cname: {
    code: CNAME_SAMPLE,
    nonObvious:
      "the target is resolved rather than string-compared. A provider that flattens aliases serves address records in place of the CNAME, so a correctly configured domain returns no CNAME at all — comparing addresses is the only way to tell that from an A record pointed elsewhere, and every address published has to be one of the target's rather than merely one of them.",
  },
  delegation: {
    code: DELEGATION_SAMPLE,
    nonObvious:
      "every nameserver in the delegation is queried individually, because a lame delegation is a fact about one server rather than about the zone: resolvers that happen to pick it get SERVFAIL while everyone else is fine.",
  },
  dkim: {
    code: DKIM_SAMPLE,
    nonObvious:
      "the key is parsed rather than pattern-matched, and DNS names fold case while base64 does not. A published key differing only in letter case from the one you issued is a different key, not a formatting quirk.",
  },
  dmarc: {
    code: DMARC_SAMPLE,
    nonObvious:
      "a record is valid at the exact name or, failing that, at the organizational domain. An external rua= destination has to publish its own authorisation record back, or the reports it is sent are silently discarded.",
  },
  mx: {
    code: MX_SAMPLE,
    nonObvious:
      "expectsMail is tri-state (true, false, or omitted) because a null MX is correct on a sending-only domain and a total failure on one that receives mail, and no amount of looking at DNS tells you which.",
  },
  ownership: {
    code: OWNERSHIP_SAMPLE,
    nonObvious:
      "the token is compared byte for byte, which is what makes this check immune to a wildcard — a zone answering every name still has to answer with your value. A near miss (stored quotes, chunks rejoined with whitespace, a truncated paste, a case fold) is reported as a mangled token rather than a wrong one.",
  },
  spf: {
    code: SPF_SAMPLE,
    nonObvious:
      "include: is expanded recursively the way a receiving MTA does it, with RFC 7208's ten-lookup and two-void-lookup ceilings counted across the whole expanded tree rather than per record.",
  },
};
