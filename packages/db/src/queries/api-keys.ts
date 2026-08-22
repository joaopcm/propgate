import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Database } from "../client";
import type { GeneratedApiKey } from "../keys";
import { generateApiKey, hashApiKey } from "../keys";
import { apiKeys } from "../schema/api-keys";
import { tenants } from "../schema/tenants";

export interface Authenticated {
  readonly apiKeyId: string;
  readonly requestQuotaPerSecond: number | null;
  readonly tenantId: string;
}

export type AuthFailure = "revoked" | "unknown";

export type AuthOutcome =
  | { readonly authenticated: Authenticated; readonly ok: true }
  | { readonly ok: false; readonly reason: AuthFailure };

const LAST_USED_RESOLUTION_MS = 60_000;

export async function createApiKey(
  db: Database,
  input: {
    readonly createdByMemberId?: string | undefined;
    readonly name: string;
    readonly tenantId: string;
  }
): Promise<GeneratedApiKey & { readonly id: string }> {
  const generated = generateApiKey();

  const [row] = await db
    .insert(apiKeys)
    .values({
      ...(input.createdByMemberId === undefined
        ? {}
        : { createdByMemberId: input.createdByMemberId }),
      hashedKey: generated.hashedKey,
      name: input.name,
      prefix: generated.prefix,
      tenantId: input.tenantId,
    })
    .returning({ id: apiKeys.id });

  if (row === undefined) {
    throw new Error("insert returned no row");
  }

  return { ...generated, id: row.id };
}

export async function revokeApiKey(
  db: Database,
  apiKeyId: string,
  now = new Date()
): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(eq(apiKeys.id, apiKeyId));
}

export async function authenticateApiKey(
  db: Database,
  presented: string,
  now = new Date()
): Promise<AuthOutcome> {
  const hashed = hashApiKey(presented);

  const [row] = await db
    .select({
      id: apiKeys.id,
      lastUsedAt: apiKeys.lastUsedAt,
      requestQuotaPerSecond: tenants.requestQuotaPerSecond,
      revokedAt: apiKeys.revokedAt,
      tenantId: apiKeys.tenantId,
    })
    .from(apiKeys)
    .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .where(eq(apiKeys.hashedKey, hashed))
    .limit(1);

  if (row === undefined) {
    return { ok: false, reason: "unknown" };
  }

  if (row.revokedAt !== null) {
    return { ok: false, reason: "revoked" };
  }

  await touchLastUsed(db, row.id, now);

  return {
    authenticated: {
      apiKeyId: row.id,
      requestQuotaPerSecond: row.requestQuotaPerSecond,
      tenantId: row.tenantId,
    },
    ok: true,
  };
}

async function touchLastUsed(
  db: Database,
  apiKeyId: string,
  now: Date
): Promise<void> {
  const staleBefore = new Date(now.getTime() - LAST_USED_RESOLUTION_MS);

  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, apiKeyId),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, staleBefore))
      )
    );
}
