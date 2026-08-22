const ID = "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a";

export const DOMAINS_CREATE = `const { data, error, meta } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
  externalId: "cust_1",
  expectations: {
    dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." },
  },
});

data?.state;
meta?.created;`;

export const DOMAINS_CHECK = `const { data, error, meta } = await propgate.domains.check("${ID}");

data?.state;
data?.requirements?.filter((requirement) => !requirement.satisfied);

meta?.superseded;`;

export const DOMAINS_UPDATE = `const { data } = await propgate.domains.update("${ID}", {
  expectations: { dkim: { expectedPublicKey: rotatedKey } },
});

data?.state;`;

export const DOMAINS_LIST = `const page = await propgate.domains.list({ state: "failed", limit: 200 });

const { data, error } = await propgate.domains.listAll({ state: "failed" });

if (error !== null) {
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

data?.lookups;

const timeline = await propgate.domains.timeline("${ID}", { limit: 50 });

await propgate.domains.remove("${ID}");`;
