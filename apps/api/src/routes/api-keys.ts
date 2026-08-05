import type { Database, TenantApiKey } from "@propgate/db";
import {
  activeApiKeyCount,
  apiKeyForTenant,
  createApiKey,
  listApiKeysForTenant,
  revokeApiKeyForTenant,
} from "@propgate/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";

/**
 * `/v1/api-keys` — a tenant managing its own credentials.
 *
 * Every query behind this is tenant-scoped by construction; see
 * `packages/db/src/queries/tenant-keys.ts` for why the operator functions in
 * `revocation.ts` are deliberately not reused here. The short version: those span
 * every tenant, which is correct for a shell on the box and a cross-tenant leak
 * behind a bearer token.
 *
 * Authenticating a key-management call with the key being revoked is fine, and
 * revoking the key you are currently holding is the normal "rotate away from
 * something that leaked" move. It must keep working, so nothing here special-cases
 * the presented key.
 *
 * **Any member of a tenant can revoke any of that tenant's keys, and that is
 * deliberate for now.** `created_by_member_id` records who made each key, so the
 * question "who added this" has an answer — but authorisation is not gated on it,
 * because the obvious gate is wrong: "only the creator may revoke" locks a tenant
 * out of its departed colleague's key at exactly the moment revoking it matters
 * most. Doing this properly needs roles, so an admin can act on somebody else's
 * key while a normal member cannot, and roles are a column on `tenant_members`
 * plus a policy — a deliberate piece of work rather than something to infer from
 * an attribution column.
 *
 * What this milestone buys is that the attribution exists *before* it is needed.
 * It cannot be backfilled: a key created today with no record of its creator is
 * unattributable forever.
 */

const MAX_NAME_LENGTH = 64;

/**
 * How many active keys one tenant may hold.
 *
 * **A tripwire, not a quota.** A real integration wants one key per environment
 * and maybe one being rotated in — call it five. Fifty is far past that, so no
 * good widget ever feels it exists, and it stops an unattended loop turning
 * `POST /v1/api-keys` into unbounded row growth on the table every authenticated
 * request reads. Revoked keys do not count: they are history, and a tenant that
 * has rotated fifty times over a year has done nothing wrong.
 *
 * If a real integration ever hits this, the number is wrong and should be
 * remeasured rather than worked around.
 */
const MAX_ACTIVE_KEYS = 50;

const createSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
});

function serialise(key: TenantApiKey) {
  return {
    createdAt: key.createdAt.toISOString(),
    /**
     * Who made it, by address, or null when nobody is on record.
     *
     * The address rather than the member id: "who" is the question, and an id
     * requires a second lookup nobody can make yet — there is no members endpoint.
     * Null is a normal answer, not an error — see the column's comment for the
     * three cases that produce it.
     */
    createdBy: key.createdByEmail,
    id: key.id,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    name: key.name,
    object: "api_key" as const,
    /**
     * The prefix, never the key.
     *
     * Only `hashed_key` is stored, so there is no code path that could return a
     * secret here even by accident — which is the property that makes "we cannot
     * show you that key again" true rather than a policy.
     */
    prefix: key.prefix,
    revoked: key.revokedAt !== null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

export function createApiKeysRoute(options: { db: Database }) {
  const route = new Hono<{ Variables: AuthVariables }>();
  const { db } = options;

  route.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 422, firstIssue(parsed.error));
    }

    const tenantId = c.get("tenantId");
    const active = await activeApiKeyCount(db, tenantId);

    if (active >= MAX_ACTIVE_KEYS) {
      // Name the budget, the limit and the ask. An agent can act on this; "429"
      // or a bare "too many keys" sends it into a retry loop against the thing
      // already saying no.
      return error(
        c,
        422,
        `active key limit of ${MAX_ACTIVE_KEYS} reached, and you hold ${active}; revoke one before creating another`
      );
    }

    /**
     * Attribution follows the key that authenticated the request.
     *
     * There is no session here — a key is not a person — so the only member this
     * request can honestly name is the one the *presenting* key is attributed to.
     * Propagating it means a chain of keys rotated over a year still points back at
     * whoever started it, which is the question an audit actually asks.
     *
     * Null propagates as null rather than being filled in with a guess. An
     * operator-minted key has no creator, and anything created with it inherits
     * that honestly instead of being attributed to whoever happens to hold it.
     */
    const presenting = await apiKeyForTenant(db, {
      apiKeyId: c.get("apiKeyId"),
      tenantId,
    });

    const created = await createApiKey(db, {
      ...(presenting?.createdByMemberId === null ||
      presenting?.createdByMemberId === undefined
        ? {}
        : { createdByMemberId: presenting.createdByMemberId }),
      name: parsed.data.name,
      tenantId,
    });

    // Read back rather than assembling the response from what we sent: `createdAt`
    // is a database default, and a `new Date()` here would be a timestamp that
    // agrees with the stored row only approximately.
    const stored = await apiKeyForTenant(db, {
      apiKeyId: created.id,
      tenantId,
    });

    if (stored === undefined) {
      throw new Error("created key could not be read back");
    }

    return success(c, {
      // The only time this is ever readable, on this route or any other.
      key: created.key,
      ...serialise(stored),
    });
  });

  route.get("/", async (c) => {
    const keys = await listApiKeysForTenant(db, c.get("tenantId"));

    return success(c, keys.map(serialise));
  });

  route.delete("/:id", async (c) => {
    const outcome = await revokeApiKeyForTenant(db, {
      apiKeyId: c.req.param("id"),
      tenantId: c.get("tenantId"),
    });

    if (outcome.kind === "not-found") {
      // Also the answer for another tenant's key id, which is the point: a 403
      // would confirm the id exists somewhere.
      return error(c, 404, "no such api key");
    }

    if (outcome.kind === "last-active") {
      return error(
        c,
        409,
        "this is your last active api key; revoking it would lock you out of this API and there is no un-revoke. Create a replacement first."
      );
    }

    return success(c, serialise(outcome.key), {
      // Distinguished in the meta rather than the status: the key is revoked
      // either way, so this is not a failure, but a script re-running its own
      // cleanup deserves to know it was not the one that did it.
      alreadyRevoked: outcome.kind === "already-revoked",
    });
  });

  return route;
}
