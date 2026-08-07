/**
 * Every sample here is checked against the real exports of `@propgate/dns` —
 * see the task report for how. None of these are captured output.
 */

export const RUN_CHECKS_BASIC = `import { runChecks, sendingOnly } from "@propgate/dns";

const profile = sendingOnly({
  dkimSelectors: ["resend"],
  spfInclude: "_spf.resend.com",
});

const result = await runChecks({
  domain: "customer.example",
  profile,
  resolver: { target: { address: "8.8.8.8", port: 53 } },
});

console.log(result.verdict, result.checks.map((check) => check.kind));`;

export const DELEGATION_SAMPLE = `import { createEvaluationContext, evaluateDelegation } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// Every nameserver in the delegation is asked the same question. No single
// server can report on another, so this is the one check that queries more
// than one target.
const result = await evaluateDelegation(context, { domain: "customer.example" });

console.log(result.verdict);`;

export const SPF_SAMPLE = `import { createEvaluationContext, evaluateSpf } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// include: is expanded recursively, the way a receiving MTA does it. RFC
// 7208 §4.6.4's ten-lookup and two-void-lookup ceilings are counted across
// the whole expanded tree, not per record — a domain can cross either limit
// without anyone having touched its own SPF record.
const result = await evaluateSpf(context, {
  domain: "customer.example",
  include: "_spf.resend.com",
});

console.log(result.verdict, result.findings.map((finding) => finding.code));`;

export const DKIM_SAMPLE = `import { createEvaluationContext, evaluateDkim } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// The key is parsed, not pattern-matched against the published record. DNS
// names fold case, so DKIM._domainkey and dkim._domainkey are the same
// query — but the base64 key value does not: expectedPublicKey is compared
// byte-exact, so a key differing only in letter case is reported as a
// different key rather than treated as a match.
const result = await evaluateDkim(context, {
  domain: "customer.example",
  selector: "resend",
  expectedPublicKey: "MIGfMA0GCSqGSIb3DQEBAQUA...",
});

console.log(result.verdict);`;

export const DMARC_SAMPLE = `import { createEvaluationContext, evaluateDmarc } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// Discovery tries the exact name first and only falls back to the
// organizational domain when nothing is published there. checkExternalReports
// (on by default) then confirms any rua= pointed at another organization has
// authorised receiving reports for this one — almost nothing else checks
// this, so unauthorised reports are addressed and silently discarded.
const result = await evaluateDmarc(context, { domain: "mail.customer.example" });

console.log(result.verdict);`;

export const MX_SAMPLE = `import { createEvaluationContext, evaluateMx } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// expectsMail is tri-state: true, false, or omitted. A null MX is the
// correct, deliberate answer on a sending-only domain and a total failure on
// one that receives mail — no amount of looking at DNS distinguishes them,
// so the caller has to say which one this is.
const result = await evaluateMx(context, {
  domain: "customer.example",
  expectsMail: false,
});

console.log(result.verdict);`;

export const CAA_SAMPLE = `import { createEvaluationContext, evaluateCaa } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// The search climbs the DNS tree from the name up to, but not including, the
// root (RFC 8659 §3) — never to the organizational domain, and the Public
// Suffix List plays no part. The nearest ancestor with a CAA RRset wins
// outright; policies are never merged up the tree.
const result = await evaluateCaa(context, {
  domain: "mail.customer.example",
  issuer: "letsencrypt.org",
  wildcard: true,
});

console.log(result.verdict);`;

export const OWNERSHIP_SAMPLE = `import { createEvaluationContext, evaluateOwnership } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// The token is compared byte for byte, which is what makes this check immune
// to a wildcard: a zone answering every name still has to answer with your
// value. Omit the label to look at the apex, where the token shares its name
// with SPF and every other vendor's token — one value among many still has to
// match exactly.
const result = await evaluateOwnership(context, {
  domain: "customer.example",
  label: "_pg-challenge",
  token: "propgate-verify=6c1f9a24b7e5d03812af49b6c5d0e7f3",
});

console.log(result.verdict);`;

export const CNAME_SAMPLE = `import { createEvaluationContext, evaluateCname } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

// The target is resolved, not just compared as a string. Providers that
// flatten aliases resolve them at edit time and serve address records
// instead, so a correctly configured domain returns no CNAME at all —
// comparing addresses is the only way to tell that apart from an A record
// pointed somewhere else.
const result = await evaluateCname(context, {
  domain: "customer.example",
  label: "track",
  target: "acme.track.propgate.com",
});

console.log(result.verdict);`;
