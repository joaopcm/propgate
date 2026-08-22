import type { Database, ProfileDefinition } from "@propgate/db";
import {
  createProfileVersion,
  currentProfileVersion,
  PER_DOMAIN_FIELDS,
} from "@propgate/db";
import { CHECK_KINDS } from "@propgate/dns";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { rejectDefinition } from "../profiles/compile";
import { error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";

const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 253;
const MAX_SELECTOR_LENGTH = 63;
const MAX_PUBLIC_KEY_LENGTH = 4096;
const MAX_TOKEN_LENGTH = 255;

const requirementSchema = z.object({
  caaIssuer: z.string().min(1).max(MAX_VALUE_LENGTH).optional(),
  check: z.enum(CHECK_KINDS),
  expectedPublicKey: z.string().min(1).max(MAX_PUBLIC_KEY_LENGTH).optional(),
  expectsMail: z.boolean().optional(),
  include: z.string().min(1).max(MAX_VALUE_LENGTH).optional(),
  key: z.string().min(1).max(MAX_KEY_LENGTH),
  label: z.string().min(1).max(MAX_VALUE_LENGTH).optional(),
  requiredPerDomain: z.array(z.enum(PER_DOMAIN_FIELDS)).min(1).optional(),
  selector: z.string().min(1).max(MAX_SELECTOR_LENGTH).optional(),
  target: z.string().min(1).max(MAX_VALUE_LENGTH).optional(),
  token: z.string().min(1).max(MAX_TOKEN_LENGTH).optional(),
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
      return error(c, 422, firstIssue(parsed.error));
    }

    const definition: ProfileDefinition = {
      requirements: parsed.data.requirements,
    };

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
