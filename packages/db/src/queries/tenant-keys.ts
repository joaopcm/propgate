import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { apiKeys } from "../schema/api-keys";
import { tenantMembers } from "../schema/tenant-members";

export interface TenantApiKey {
  readonly createdAt: Date;
  readonly createdByEmail: string | null;
  readonly createdByMemberId: string | null;
  readonly id: string;
  readonly lastUsedAt: Date | null;
  readonly name: string;
  readonly prefix: string;
  readonly revokedAt: Date | null;
}

const SUMMARY = {
  createdAt: apiKeys.createdAt,
  createdByEmail: tenantMembers.email,
  createdByMemberId: apiKeys.createdByMemberId,
  id: apiKeys.id,
  lastUsedAt: apiKeys.lastUsedAt,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  revokedAt: apiKeys.revokedAt,
};

export async function listApiKeysForTenant(
  db: Database,
  tenantId: string
): Promise<readonly TenantApiKey[]> {
  return await db
    .select(SUMMARY)
    .from(apiKeys)
    .leftJoin(tenantMembers, eq(tenantMembers.id, apiKeys.createdByMemberId))
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));
}

export async function apiKeyForTenant(
  db: Database,
  input: { readonly apiKeyId: string; readonly tenantId: string }
): Promise<TenantApiKey | undefined> {
  const [row] = await db
    .select(SUMMARY)
    .from(apiKeys)
    .leftJoin(tenantMembers, eq(tenantMembers.id, apiKeys.createdByMemberId))
    .where(
      and(eq(apiKeys.id, input.apiKeyId), eq(apiKeys.tenantId, input.tenantId))
    )
    .limit(1);

  return row;
}

export type TenantRevokeOutcome =
  | { readonly key: TenantApiKey; readonly kind: "already-revoked" }
  | { readonly key: TenantApiKey; readonly kind: "last-active" }
  | { readonly key: TenantApiKey; readonly kind: "revoked" }
  | { readonly kind: "not-found" };

export async function revokeApiKeyForTenant(
  db: Database,
  input: { readonly apiKeyId: string; readonly tenantId: string }
): Promise<TenantRevokeOutcome> {
  return await db.transaction(async (tx): Promise<TenantRevokeOutcome> => {
    const [key] = await tx
      .select(SUMMARY)
      .from(apiKeys)
      .leftJoin(tenantMembers, eq(tenantMembers.id, apiKeys.createdByMemberId))
      .where(
        and(
          eq(apiKeys.id, input.apiKeyId),
          eq(apiKeys.tenantId, input.tenantId)
        )
      )
      .limit(1);

    if (key === undefined) {
      return { kind: "not-found" };
    }

    if (key.revokedAt !== null) {
      return { key, kind: "already-revoked" };
    }

    const active = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(
        and(eq(apiKeys.tenantId, input.tenantId), isNull(apiKeys.revokedAt))
      )
      .for("update");

    if (active.length <= 1) {
      return { key, kind: "last-active" };
    }

    const [revoked] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, key.id))
      .returning({ revokedAt: apiKeys.revokedAt });

    if (revoked === undefined) {
      throw new Error("revoke returned no row");
    }

    return { key: { ...key, revokedAt: revoked.revokedAt }, kind: "revoked" };
  });
}
