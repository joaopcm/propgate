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

const MAX_NAME_LENGTH = 64;

const MAX_ACTIVE_KEYS = 50;

const createSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
});

function serialise(key: TenantApiKey) {
  return {
    createdAt: key.createdAt.toISOString(),
    createdBy: key.createdByEmail,
    id: key.id,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    name: key.name,
    object: "api_key" as const,
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
      return error(
        c,
        422,
        `active key limit of ${MAX_ACTIVE_KEYS} reached, and you hold ${active}; revoke one before creating another`
      );
    }

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

    const stored = await apiKeyForTenant(db, {
      apiKeyId: created.id,
      tenantId,
    });

    if (stored === undefined) {
      throw new Error("created key could not be read back");
    }

    return success(c, {
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
      alreadyRevoked: outcome.kind === "already-revoked",
    });
  });

  return route;
}
