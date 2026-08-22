import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { tenantMembers } from "../schema/tenant-members";
import { tenants } from "../schema/tenants";
import { createApiKey } from "./api-keys";

export interface MintedKey {
  readonly key: string;
  readonly tenantId: string;
}

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
  readonly created: boolean;
  readonly memberId: string;
  readonly tenantId: string;
}

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
