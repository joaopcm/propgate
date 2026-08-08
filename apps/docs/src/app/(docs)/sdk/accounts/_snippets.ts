/**
 * Keys and members, from Node.
 *
 * There is no signup here — see the page. Method names are checked against
 * `@propgate/sdk` by `src/lib/sdk.spec.ts`.
 */

export const ACCOUNTS_CREATE_KEY = `const { data, error } = await propgate.apiKeys.create({ name: "staging" });

// The only time the secret is ever readable, on this route or any other.
await writeToSecretStore(data?.key);

data?.prefix; // "pg_live_9f2a" — what every later call shows instead`;

export const ACCOUNTS_LIST_KEYS = `const { data } = await propgate.apiKeys.list();

for (const key of data ?? []) {
  console.log(key.name, key.prefix, key.createdBy, key.lastUsedAt, key.revoked);
}`;

export const ACCOUNTS_ROTATE = `// Mint the replacement first, deploy it, then revoke the old one — in that
// order, because there is no un-revoke.
const minted = await propgate.apiKeys.create({ name: "production-2026-08" });

await deploy(minted.data?.key);

const { meta } = await propgate.apiKeys.revoke(previousKeyId);

meta?.alreadyRevoked; // false if this call was the one that did it`;

export const ACCOUNTS_MEMBERS = `const { data } = await propgate.members.list();

// Turns the createdBy address on a key into something you can check against.
const addresses = new Set((data ?? []).map((member) => member.email));`;
