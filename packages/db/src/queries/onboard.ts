import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { tenants } from "../schema/tenants";
import { createApiKey } from "./api-keys";

export interface MintedKey {
  readonly key: string;
  readonly tenantId: string;
}

/**
 * A tenant and a key, creating the tenant only if it is new.
 *
 * There is no self-service signup and no admin API — both deliberately out of
 * scope — so this is the entire onboarding path. Idempotent on the tenant name
 * so minting a second key for an existing partner is the same command.
 */
export async function mintTenantKey(
  db: Database,
  input: { readonly keyName: string; readonly tenantName: string }
): Promise<MintedKey> {
  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, input.tenantName))
    .limit(1);

  const tenantId =
    existing?.id ??
    (
      await db
        .insert(tenants)
        .values({ name: input.tenantName })
        .returning({ id: tenants.id })
    )[0]?.id;

  if (tenantId === undefined) {
    throw new Error("could not resolve a tenant");
  }

  const created = await createApiKey(db, { name: input.keyName, tenantId });

  return { key: created.key, tenantId };
}
