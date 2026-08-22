export const SDK_INSTALL = "npm install @propgate/sdk";

export const SDK_CLIENT = `import { Propgate } from "@propgate/sdk";

const propgate = new Propgate("pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

const { data, error } = await propgate.domains.check("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");

if (error) {
  console.error(error.code, error.message);
} else {
  console.log(data.state, \`\${data.requirementsMet}/\${data.requirementsTotal}\`);
}`;

export const SDK_ENVELOPE = `const { data, error, meta } = await propgate.domains.list({ state: "failed" });

if (error !== null) {
  return;
}

for (const domain of data) {
  console.log(domain.name, domain.state);
}

meta.nextCursor;`;

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

error?.code;`;

export const SDK_ANONYMOUS = `import { Propgate } from "@propgate/sdk";

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
