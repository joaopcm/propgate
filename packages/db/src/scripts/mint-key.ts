import { eq } from "drizzle-orm";
import { createDb } from "../client";
import { createApiKey } from "../queries/api-keys";
import { tenants } from "../schema/tenants";

/**
 * Mint a tenant and an API key from the command line.
 *
 * There is no self-service signup and no admin API, so without this there is no
 * way to onboard the design partner at all. Deliberately the smallest thing
 * that closes that gap rather than the first slice of a control plane.
 *
 *   pnpm --filter @propgate/db db:mint "Partner name" "key name"
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

const existing = await db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.name, tenantName))
  .limit(1);

const tenantId =
  existing[0]?.id ??
  (
    await db.insert(tenants).values({ name: tenantName }).returning({
      id: tenants.id,
    })
  )[0]?.id;

if (tenantId === undefined) {
  process.stderr.write("could not resolve a tenant\n");
  process.exit(1);
}

const created = await createApiKey(db, { name: keyName, tenantId });

// The one and only time the key exists in readable form.
process.stdout.write(
  `tenant  ${tenantId}  ${tenantName}\nkey     ${created.key}\n\nStore it now. Only the hash is kept.\n`
);

await db.$client.end();
