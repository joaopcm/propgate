import { createDb } from "../client";
import { mintTenantKey } from "../queries/onboard";

/**
 * Mint a tenant and an API key against a local checkout.
 *
 *   pnpm --filter @propgate/db db:mint "Partner name" "key name"
 *
 * In production the same thing is a subcommand of the API image, so the box
 * needs no toolchain — see `apps/api/src/mint.ts`.
 */

const [tenantName, keyName = "default"] = process.argv.slice(2);

if (tenantName === undefined || tenantName === "") {
  process.stderr.write(
    'usage: pnpm --filter @propgate/db db:mint "<tenant name>" [key name]\n'
  );
  process.exit(2);
}

const url = process.env.DATABASE_URL;

if (url === undefined || url === "") {
  process.stderr.write("DATABASE_URL is unset\n");
  process.exit(2);
}

const db = createDb(url, { maxConnections: 1 });
const minted = await mintTenantKey(db, { keyName, tenantName });

// The one and only time the key exists in readable form.
process.stdout.write(
  `tenant  ${minted.tenantId}  ${tenantName}\nkey     ${minted.key}\n\nStore it now. Only the hash is kept.\n`
);

await db.$client.end();
