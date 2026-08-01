import type { Database } from "@propgate/db";
import { authenticateApiKey } from "@propgate/db";
import { createMiddleware } from "hono/factory";
import { error } from "../utils/response";

/**
 * Bearer authentication against the `api_keys` table.
 *
 * Every authenticated route reads its tenant from here and from nowhere else.
 * A route that takes a tenant id from the request body, or from anything a
 * caller controls, is a tenancy bug with a straight line to another partner's
 * data — so the tenant is set once, by this middleware, from a value only the
 * key holder could have presented.
 */

export interface AuthVariables {
  readonly apiKeyId: string;
  readonly tenantId: string;
}

const BEARER = /^bearer\s+(\S+)$/i;

export function bearerAuth(db: Database) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header("authorization");

    if (header === undefined) {
      return error(
        c,
        401,
        "missing Authorization header; expected `Authorization: Bearer pg_live_...`"
      );
    }

    const presented = BEARER.exec(header)?.[1];

    if (presented === undefined) {
      return error(c, 401, "Authorization header must use the Bearer scheme");
    }

    const outcome = await authenticateApiKey(db, presented);

    if (!outcome.ok) {
      // The holder of a key already knows the key. Naming its state leaks
      // nothing and saves them hunting for a typo that is not there.
      return error(
        c,
        401,
        outcome.reason === "revoked"
          ? "this API key has been revoked"
          : "invalid API key"
      );
    }

    c.set("apiKeyId", outcome.authenticated.apiKeyId);
    c.set("tenantId", outcome.authenticated.tenantId);

    await next();
  });
}
