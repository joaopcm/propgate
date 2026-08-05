import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { tenantMembers } from "../schema/tenant-members";
import { tenants } from "../schema/tenants";
import { createApiKey } from "./api-keys";

export interface MintedKey {
  readonly key: string;
  readonly tenantId: string;
}

/**
 * A tenant and a key, creating the tenant only if it is new.
 *
 * The operator path, driven by `mint.ts` over a shell. Self-serve signup goes
 * through `findOrCreateAccountForEmail` below instead, because there the
 * identity being proved is a mailbox rather than a name somebody typed.
 * Idempotent on the tenant name so minting a second key for an existing partner
 * is the same command.
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

export interface Account {
  /** False when the address already had a tenant, which is not an error. */
  readonly created: boolean;
  readonly memberId: string;
  readonly tenantId: string;
}

/**
 * The tenant behind a confirmed address, creating it on first sight.
 *
 * This is where "idempotent" in the signup flow is actually enforced, and it is
 * at the *tenant* level rather than the request level: an address maps to at
 * most one tenant, forever. Running the whole flow again on a known address
 * therefore lands on the same tenant and mints an additional key against it,
 * which doubles as the recovery path for somebody who lost theirs — and is why
 * v1 needs no separate sign-in.
 *
 * One transaction, so a tenant can never exist without the member that explains
 * who it belongs to. The select-then-insert is safe rather than racy because the
 * only caller has just spent a single-use code, and the unique index on
 * `tenant_members.email` is the backstop if that ever stops being true: a second
 * concurrent insert aborts the transaction instead of quietly building a second
 * account for one address.
 */
export async function findOrCreateAccountForEmail(
  db: Database,
  input: { readonly email: string }
): Promise<Account> {
  return await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: tenantMembers.id, tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.email, input.email))
      .limit(1);

    if (member !== undefined) {
      return {
        created: false,
        memberId: member.id,
        tenantId: member.tenantId,
      };
    }

    // The address as the tenant name. A self-serve tenant has no other name to
    // go by, and inventing one ("Tenant 4f2c…") would put a label in front of
    // the only identifier anybody can actually act on.
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: input.email })
      .returning({ id: tenants.id });

    if (tenant === undefined) {
      throw new Error("tenant insert returned no row");
    }

    const [inserted] = await tx
      .insert(tenantMembers)
      .values({ email: input.email, tenantId: tenant.id })
      .returning({ id: tenantMembers.id });

    if (inserted === undefined) {
      throw new Error("tenant member insert returned no row");
    }

    return { created: true, memberId: inserted.id, tenantId: tenant.id };
  });
}
