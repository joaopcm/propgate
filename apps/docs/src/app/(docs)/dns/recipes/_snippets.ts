/**
 * Every sample here is checked against the real exports of `@propgate/dns` —
 * see the task report for how. Each is a complete, runnable file.
 */

export const RECIPE_CHECK_AND_SWITCH = `import { runChecks, sendingOnly } from "@propgate/dns";

const profile = sendingOnly({
  dkimSelectors: ["resend"],
  spfInclude: "_spf.resend.com",
});

const result = await runChecks({
  domain: "customer.example",
  profile,
  resolver: { target: { address: "8.8.8.8", port: 53 } },
});

switch (result.verdict) {
  case "pass":
    console.log(\`\${result.domain}: every check passed\`);
    break;
  case "warn":
    console.log(\`\${result.domain}: passing, with warnings worth reading\`);
    break;
  case "fail":
    console.log(\`\${result.domain}: not configured correctly\`);
    break;
  case "indeterminate":
    console.log(\`\${result.domain}: could not be checked right now — try again\`);
    break;
}`;

export const RECIPE_CUSTOM_RESOLVER_PORT = `import { runChecks, webOnly } from "@propgate/dns";

// A resolver container listening on a non-standard port, the way this
// repo's own DNS fixture tier does. Production nameservers still listen on
// 53, but nothing about the resolver assumes that — the target is always
// { address, port, transport }.
const result = await runChecks({
  domain: "customer.example",
  profile: webOnly({ caaIssuer: "letsencrypt.org" }),
  resolver: {
    target: { address: "127.0.0.1", port: 8053, transport: "udp" },
  },
});

console.log(result.verdict);`;

export const RECIPE_EXPLAIN_VERDICT = `import { fullMail, outcomeFor, runChecks } from "@propgate/dns";

const result = await runChecks({
  domain: "customer.example",
  profile: fullMail({ dkimSelectors: ["resend"] }),
  resolver: { target: { address: "8.8.8.8", port: 53 } },
});

const dkim = outcomeFor(result, "dkim");

if (dkim === undefined) {
  console.log("DKIM was not asked for on this profile");
} else if (dkim.verdict === "pass") {
  console.log("DKIM is set up correctly");
} else {
  // The findings say what's wrong; the lookups say how we know. A customer
  // asking "why does your dashboard say this is broken" gets the name
  // queried, what came back, and which finding that answer produced —
  // nothing here has to be re-derived by re-running the check by hand.
  for (const finding of dkim.findings) {
    console.log(finding.code, "—", finding.evidence.detail ?? finding.evidence.observed);
  }

  for (const lookup of dkim.lookups) {
    console.log(lookup.name, lookup.purpose, "->", lookup.outcome.status);
  }
}`;
