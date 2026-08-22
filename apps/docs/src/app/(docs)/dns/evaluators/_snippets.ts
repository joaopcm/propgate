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

const result = await evaluateDelegation(context, { domain: "customer.example" });

console.log(result.verdict);`;

export const SPF_SAMPLE = `import { createEvaluationContext, evaluateSpf } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

const result = await evaluateSpf(context, {
  domain: "customer.example",
  include: "_spf.resend.com",
});

console.log(result.verdict, result.findings.map((finding) => finding.code));`;

export const DKIM_SAMPLE = `import { createEvaluationContext, evaluateDkim } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

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

const result = await evaluateDmarc(context, { domain: "mail.customer.example" });

console.log(result.verdict);`;

export const MX_SAMPLE = `import { createEvaluationContext, evaluateMx } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

const result = await evaluateMx(context, {
  domain: "customer.example",
  expectsMail: false,
});

console.log(result.verdict);`;

export const CAA_SAMPLE = `import { createEvaluationContext, evaluateCaa } from "@propgate/dns";

const context = createEvaluationContext({
  target: { address: "8.8.8.8", port: 53 },
});

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

const result = await evaluateCname(context, {
  domain: "customer.example",
  label: "track",
  target: "acme.track.propgate.com",
});

console.log(result.verdict);`;
