import { and, asc, count, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../client";
import { apiKeys } from "../schema/api-keys";
import { tenants } from "../schema/tenants";
import { revokeApiKey } from "./api-keys";

export interface ApiKeySummary {
  readonly createdAt: Date;
  readonly id: string;
  readonly lastUsedAt: Date | null;
  readonly name: string;
  readonly prefix: string;
  readonly revokedAt: Date | null;
  readonly tenantId: string;
  readonly tenantName: string;
}

const SUMMARY = {
  createdAt: apiKeys.createdAt,
  id: apiKeys.id,
  lastUsedAt: apiKeys.lastUsedAt,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  revokedAt: apiKeys.revokedAt,
  tenantId: apiKeys.tenantId,
  tenantName: tenants.name,
};

export async function listApiKeys(
  db: Database
): Promise<readonly ApiKeySummary[]> {
  return await db
    .select(SUMMARY)
    .from(apiKeys)
    .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .orderBy(asc(tenants.name), asc(apiKeys.id));
}

export async function apiKeysMatching(
  db: Database,
  reference: string
): Promise<readonly ApiKeySummary[]> {
  return await db
    .select(SUMMARY)
    .from(apiKeys)
    .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .where(or(eq(apiKeys.prefix, reference), eq(apiKeys.id, reference)))
    .orderBy(asc(apiKeys.id));
}

export async function activeApiKeyCount(
  db: Database,
  tenantId: string
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)));

  return row?.total ?? 0;
}

export type RevokeOutcome =
  | { readonly key: ApiKeySummary; readonly kind: "already-revoked" }
  | { readonly key: ApiKeySummary; readonly kind: "last-active" }
  | { readonly key: ApiKeySummary; readonly kind: "revoked" }
  | { readonly kind: "ambiguous"; readonly matches: readonly ApiKeySummary[] }
  | { readonly kind: "not-found" };

export async function revokeApiKeyByReference(
  db: Database,
  reference: string,
  options: { readonly force?: boolean } = {}
): Promise<RevokeOutcome> {
  const matches = await apiKeysMatching(db, reference);
  const [key] = matches;

  if (key === undefined) {
    return { kind: "not-found" };
  }

  if (matches.length > 1) {
    return { kind: "ambiguous", matches };
  }

  if (key.revokedAt !== null) {
    return { key, kind: "already-revoked" };
  }

  if (
    options.force !== true &&
    (await activeApiKeyCount(db, key.tenantId)) <= 1
  ) {
    return { key, kind: "last-active" };
  }

  await revokeApiKey(db, key.id);

  return { key, kind: "revoked" };
}
