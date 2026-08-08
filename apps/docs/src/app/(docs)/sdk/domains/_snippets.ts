/**
 * The domain lifecycle, from Node.
 *
 * Ids and values match `/api/domains/*` so the two references describe one
 * account. `src/lib/sdk.spec.ts` checks every method name against
 * `@propgate/sdk`.
 */

const ID = "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a";

export const DOMAINS_CREATE = `const { data, error, meta } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
  externalId: "cust_1",
  expectations: {
    dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." },
  },
});

data?.state; // "pending" — registering does not touch DNS
meta?.created; // false means this externalId already existed, and nothing was written`;

export const DOMAINS_CHECK = `const { data, error, meta } = await propgate.domains.check("${ID}");

data?.state; // "pending" | "verifying" | "verified" | "degraded" | "failed"
data?.requirements?.filter((requirement) => !requirement.satisfied);

// True when the domain's configuration changed while the check was running, so
// the verdict was discarded. The row comes back as it now stands.
meta?.superseded;`;

export const DOMAINS_UPDATE = `// A DKIM rotation. Never a second create: that path is idempotent and would
// answer 200 having written nothing.
const { data } = await propgate.domains.update("${ID}", {
  expectations: { dkim: { expectedPublicKey: rotatedKey } },
});

data?.state; // back to "pending" — nothing has judged the new value yet`;

export const DOMAINS_LIST = `// One page, and the cursor for the next.
const page = await propgate.domains.list({ state: "failed", limit: 200 });

// Or every page, 200 rows a request, stopping on a failure rather than
// returning a short list.
const { data, error } = await propgate.domains.listAll({ state: "failed" });

if (error !== null) {
  // Half a reconciliation is worse than none: this is a failure, not an
  // empty account.
  throw error;
}`;

export const DOMAINS_RECONCILE = `import { Propgate } from "@propgate/sdk";

const propgate = new Propgate(process.env.PROPGATE_API_KEY);

export async function reconcile() {
  const { data, error } = await propgate.domains.listAll();

  if (error !== null) {
    throw error;
  }

  for (const domain of data) {
    await upsertCustomerDomain({
      customerId: domain.externalId,
      lastCheckedAt: domain.lastCheckedAt,
      state: domain.state,
      unmet: (domain.requirementsTotal ?? 0) - (domain.requirementsMet ?? 0),
    });
  }
}`;

export const DOMAINS_READ = `const { data } = await propgate.domains.get("${ID}");

// The derivation behind the stored verdict: which name, which server, what
// came back. Present on get and check, absent from the list.
data?.lookups;

// What actually changed, newest first. Two identical checks add nothing.
const timeline = await propgate.domains.timeline("${ID}", { limit: 50 });

await propgate.domains.remove("${ID}");`;
