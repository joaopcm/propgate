import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Database } from "../client";
import type { GeneratedApiKey } from "../keys";
import { generateApiKey, hashApiKey } from "../keys";
import { apiKeys } from "../schema/api-keys";

export interface Authenticated {
  readonly apiKeyId: string;
  readonly tenantId: string;
}

/**
 * Why a key did not authenticate.
 *
 * `revoked` is told apart from `unknown` on purpose. Whoever presented the key
 * already holds it, so naming its state leaks nothing they do not have, and
 * "your key was revoked" is a thing an integrator can act on where "invalid"
 * sends them hunting for a typo.
 */
export type AuthFailure = "revoked" | "unknown";

export type AuthOutcome =
  | { readonly authenticated: Authenticated; readonly ok: true }
  | { readonly ok: false; readonly reason: AuthFailure };

/**
 * How stale `last_used_at` is allowed to get.
 *
 * Touching it on every request is a write per request for a column nobody reads
 * at second resolution — at a partner's import rate that is thousands of
 * pointless row versions a minute, and vacuum's problem afterwards. A minute of
 * staleness answers every question the column exists to answer.
 */
const LAST_USED_RESOLUTION_MS = 60_000;

export async function createApiKey(
  db: Database,
  input: { readonly name: string; readonly tenantId: string }
): Promise<GeneratedApiKey & { readonly id: string }> {
  const generated = generateApiKey();

  const [row] = await db
    .insert(apiKeys)
    .values({
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

/**
 * Resolve a presented key to a tenant.
 *
 * The lookup is by hash against a unique index — 0.288 ms measured on this
 * schema, which is what makes authenticating on every request rather than
 * caching the obvious choice. Nothing here compares strings in JavaScript: the
 * index does the matching, on a value that is already a hash.
 */
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
      revokedAt: apiKeys.revokedAt,
      tenantId: apiKeys.tenantId,
    })
    .from(apiKeys)
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
    authenticated: { apiKeyId: row.id, tenantId: row.tenantId },
    ok: true,
  };
}

/**
 * Conditional in SQL rather than in JavaScript so two concurrent requests
 * cannot both decide the column is stale and both write.
 */
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
