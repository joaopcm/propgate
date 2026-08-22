import { createDb, mintTenantKey } from "@propgate/db";
import { requireDatabaseUrl } from "./utils/database-url";

const [tenantName, keyName = "default"] = process.argv.slice(2);

if (tenantName === undefined || tenantName === "") {
  process.stderr.write('usage: node dist/mint.js "<tenant name>" [key name]\n');
  process.exit(2);
}

const db = createDb(requireDatabaseUrl(), { maxConnections: 1 });
const minted = await mintTenantKey(db, { keyName, tenantName });

process.stdout.write(
  `tenant  ${minted.tenantId}  ${tenantName}\nkey     ${minted.key}\n\nStore it now. Only the hash is kept.\n`
);

await db.$client.end();
