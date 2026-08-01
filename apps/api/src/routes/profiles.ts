import type { Database, ProfileDefinition } from "@propgate/db";
import { createProfileVersion, currentProfileVersion } from "@propgate/db";
import { CHECK_KINDS } from "@propgate/dns";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { rejectDefinition } from "../profiles/compile";
import { error, success } from "../utils/response";

/**
 * `POST /v1/profiles` and `GET /v1/profiles/:key`.
 *
 * A profile is what a tenant expects of a domain's records. Editing one writes
 * a new version rather than changing the old, because domains pin the version
 * they were registered against — see `packages/db/src/schema/profiles.ts`.
 */

const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 253;
const MAX_SELECTOR_LENGTH = 63;
const MAX_PUBLIC_KEY_LENGTH = 4096;

const requirementSchema = z.object({
  caaIssuer: z.string().min(1).max(MAX_VALUE_LENGTH).optional(),
  check: z.enum(CHECK_KINDS),
  expectedPublicKey: z.string().min(1).max(MAX_PUBLIC_KEY_LENGTH).optional(),
  expectsMail: z.boolean().optional(),
  include: z.string().min(1).max(MAX_VALUE_LENGTH).optional(),
  key: z.string().min(1).max(MAX_KEY_LENGTH),
  selector: z.string().min(1).max(MAX_SELECTOR_LENGTH).optional(),
});

const createSchema = z.object({
  key: z.string().min(1).max(MAX_KEY_LENGTH),
  requirements: z.array(requirementSchema).min(1),
});

function serialise(version: {
  definition: ProfileDefinition;
  id: string;
  key: string;
  version: number;
}) {
  return {
    id: version.id,
    key: version.key,
    object: "profile" as const,
    requirements: version.definition.requirements,
    version: version.version,
  };
}

export function createProfilesRoute(options: { db: Database }) {
  const route = new Hono<{ Variables: AuthVariables }>();

  route.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return error(
        c,
        422,
        parsed.error.issues.at(0)?.message ?? "invalid request"
      );
    }

    const definition: ProfileDefinition = {
      requirements: parsed.data.requirements,
    };

    // Zod covers the shape. This covers whether the evaluators could ever
    // answer it, which a schema cannot express.
    const rejection = rejectDefinition(definition);

    if (rejection !== null) {
      return error(c, 422, rejection);
    }

    const created = await createProfileVersion(options.db, {
      definition,
      key: parsed.data.key,
      tenantId: c.get("tenantId"),
    });

    return success(c, serialise(created));
  });

  route.get("/:key", async (c) => {
    const version = await currentProfileVersion(
      options.db,
      c.get("tenantId"),
      c.req.param("key")
    );

    if (version === undefined) {
      return error(c, 404, `no profile named "${c.req.param("key")}"`);
    }

    return success(c, serialise(version));
  });

  return route;
}
