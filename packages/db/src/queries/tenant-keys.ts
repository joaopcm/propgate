import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { apiKeys } from "../schema/api-keys";
import { tenantMembers } from "../schema/tenant-members";

/**
 * Keys, scoped to one tenant, for a tenant managing its own.
 *
 * **Separate from `revocation.ts` on purpose, and the distinction is load-bearing
 * rather than tidiness.** Those functions are an operator's view: `listApiKeys`
 * returns every key across every tenant, and `revokeApiKeyByReference` matches a
 * four-character prefix against the whole table. Both are right for somebody with
 * a shell on the box and catastrophic behind an HTTP route — the first is a
 * cross-tenant leak, the second lets one tenant revoke another's access by
 * guessing four characters.
 *
 * So the route gets its own queries, every one of them taking a `tenantId` that
 * came from an authenticated key and filtering on it in SQL. Nothing here accepts
 * a prefix: over HTTP the caller lists their keys and gets ids back, so there is
 * no reason to offer the ambiguous lookup that exists for an operator typing from
 * memory.
 */

export interface TenantApiKey {
  readonly createdAt: Date;
  /**
   * The address of the member who created it, or null when nobody is on record.
   *
   * Null has three honest causes and none of them are errors: the key predates the
   * column, an operator minted it over a shell, or it was created by a key that
   * itself had no creator. Rendered rather than the member id, because an id
   * answers "which row" and the question being asked is "who".
   */
  readonly createdByEmail: string | null;
  readonly createdByMemberId: string | null;
  readonly id: string;
  readonly lastUsedAt: Date | null;
  readonly name: string;
  /**
   * The leading characters, kept in clear.
   *
   * The whole reason a key is identifiable in a list at all. Never the key —
   * `hashed_key` is what is stored, so no query could return one even by mistake.
   */
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

/**
 * One tenant's keys, oldest first, revoked ones included.
 *
 * Revoked keys stay in the list because "when did this stop working" is the
 * question somebody asks while debugging a 401, and hiding them turns a two-second
 * answer into a support conversation.
 */
export async function listApiKeysForTenant(
  db: Database,
  tenantId: string
): Promise<readonly TenantApiKey[]> {
  return await db
    .select(SUMMARY)
    .from(apiKeys)
    // Left, emphatically. `created_by_member_id` is null for every key that
    // predates it and for every operator-minted one, and an inner join would drop
    // exactly those rows — a list that silently omits the oldest keys, which are
    // the ones somebody auditing is most likely to be looking for.
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
      // Both predicates, always. Filtering on the id alone and checking the
      // tenant afterwards is the same bug written later, and it is the one that
      // reads as harmless in review.
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

/**
 * Revoke one of this tenant's keys.
 *
 * Refusing the last active key is the one guard, and it is the same one the
 * operator CLI has: there is no un-revoke, so a tenant that revokes its way to
 * zero keys has locked itself out of the API that would let it make another. The
 * only way back would be the signup flow, and the mailbox may not still be
 * reachable by whoever is holding the terminal.
 *
 * `force` is deliberately **not** plumbed through from HTTP. An operator with a
 * shell can still do it — that is what `keys.js revoke --force` is for — and the
 * difference is that they can also mint the replacement.
 *
 * Revoking the key that authenticated the request is allowed and must stay that
 * way: rotating away from a key you think has leaked is exactly the moment you
 * want this to work, and the new key was created before this call.
 */
export async function revokeApiKeyForTenant(
  db: Database,
  input: { readonly apiKeyId: string; readonly tenantId: string }
): Promise<TenantRevokeOutcome> {
  // Annotated, so the `kind` literals stay literals: inferred from the returns
  // alone they widen to `string` and stop satisfying the union.
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
      // Not an error and not a silent success: re-running should say the key was
      // already gone rather than imply this call is what did it.
      return { key, kind: "already-revoked" };
    }

    /**
     * Lock this tenant's active keys, then count them.
     *
     * Counting without the lock is a real hole rather than a theoretical one: a
     * tenant with two keys revoking both at once has each call see a count of two
     * and each revoke a different row, so no row lock ever conflicts and the
     * tenant ends with zero keys and no way back. The subquery-inside-the-update
     * version has the same flaw, because both statements read the same snapshot.
     *
     * Taking `FOR UPDATE` on every active row makes the second call wait for the
     * first to commit and then see a count of one, which is the answer that
     * refuses. This is the same discipline as `claimDueDomains` — decide under a
     * lock, not from a read that was true a moment ago.
     */
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

    /**
     * Only `revoked_at` comes back from the update.
     *
     * `SUMMARY` now reaches into `tenant_members` for the creator's address, and
     * `RETURNING` cannot see a joined table — it returns columns of the row being
     * written and nothing else. So the update returns the one field it changed and
     * that is merged into the row already read above, which keeps the response
     * honest about `revoked_at` without paying for a second joined read.
     */
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
