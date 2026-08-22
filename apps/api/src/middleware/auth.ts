import type { Database } from "@propgate/db";
import { authenticateApiKey } from "@propgate/db";
import { createMiddleware } from "hono/factory";
import { error } from "../utils/response";

export interface AuthVariables {
  readonly apiKeyId: string;
  readonly requestQuotaPerSecond: number | null;
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
      return error(
        c,
        401,
        outcome.reason === "revoked"
          ? "this API key has been revoked"
          : "invalid API key"
      );
    }

    c.set("apiKeyId", outcome.authenticated.apiKeyId);
    c.set("requestQuotaPerSecond", outcome.authenticated.requestQuotaPerSecond);
    c.set("tenantId", outcome.authenticated.tenantId);

    await next();
  });
}
