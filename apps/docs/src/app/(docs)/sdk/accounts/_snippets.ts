export const ACCOUNTS_CREATE_KEY = `const { data, error } = await propgate.apiKeys.create({ name: "staging" });

await writeToSecretStore(data?.key);

data?.prefix;`;

export const ACCOUNTS_LIST_KEYS = `const { data } = await propgate.apiKeys.list();

for (const key of data ?? []) {
  console.log(key.name, key.prefix, key.createdBy, key.lastUsedAt, key.revoked);
}`;

export const ACCOUNTS_ROTATE = `const minted = await propgate.apiKeys.create({ name: "production-2026-08" });

await deploy(minted.data?.key);

const { meta } = await propgate.apiKeys.revoke(previousKeyId);

meta?.alreadyRevoked;`;

export const ACCOUNTS_MEMBERS = `const { data } = await propgate.members.list();

const addresses = new Set((data ?? []).map((member) => member.email));`;
