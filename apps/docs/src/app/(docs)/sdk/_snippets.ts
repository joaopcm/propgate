/**
 * The overview's examples.
 *
 * Written against `@propgate/sdk`'s public surface, and checked against it by
 * `src/lib/sdk.spec.ts`: every `propgate.<resource>.<method>(` here has to be a
 * method the client actually has, so a rename fails the build rather than
 * shipping a page that reads plausibly and does nothing.
 */

export const SDK_INSTALL = "npm install @propgate/sdk";

export const SDK_CLIENT = `import { Propgate } from "@propgate/sdk";

// Falls back to PROPGATE_API_KEY when the argument is omitted.
const propgate = new Propgate("pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

const { data, error } = await propgate.domains.check("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");

if (error) {
  console.error(error.code, error.message);
} else {
  console.log(data.state, \`\${data.requirementsMet}/\${data.requirementsTotal}\`);
}`;

export const SDK_ENVELOPE = `const { data, error, meta } = await propgate.domains.list({ state: "failed" });

if (error !== null) {
  // error.code is a union: "not_found" | "rate_limited" | "unauthorized" | …
  // error.statusCode is the HTTP status, or 0 when there never was a response.
  return;
}

// data is a Domain[] from here on, with no cast and no non-null assertion.
for (const domain of data) {
  console.log(domain.name, domain.state);
}

meta.nextCursor; // null when there is no further page`;

export const SDK_OPTIONS = `const propgate = new Propgate(process.env.PROPGATE_API_KEY, {
  baseUrl: "https://api.propgate.dev",
  maxRetries: 2,
  timeoutMs: 30_000,
  fetch: myInstrumentedFetch,
});`;

export const SDK_PER_CALL = `const controller = new AbortController();

setTimeout(() => controller.abort(), 5000);

const { error } = await propgate.domains.listAll(
  { state: "failed" },
  { signal: controller.signal, timeoutMs: 60_000 }
);

error?.code; // "aborted" if the controller fired first`;

export const SDK_ANONYMOUS = `import { Propgate } from "@propgate/sdk";

// No key: checks.run and health are the two calls that do not need one.
const propgate = new Propgate();

const { data } = await propgate.checks.run({
  domain: "example.com",
  checks: ["spf", "dkim"],
  dkimSelectors: ["google"],
});

for (const finding of data?.findings ?? []) {
  console.log(finding.severity, finding.code, finding.summary);
}`;

export const SDK_TYPES = `import type { Domain, DomainState, Finding, PropgateResult } from "@propgate/sdk";

function needsAttention(domain: Domain): boolean {
  const failing: DomainState[] = ["degraded", "failed"];

  return failing.includes(domain.state);
}

function firstError(findings: readonly Finding[]): Finding | undefined {
  return findings.find((finding) => finding.severity === "error");
}`;
