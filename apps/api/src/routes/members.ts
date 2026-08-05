import type { Database, TenantMember } from "@propgate/db";
import { listMembersForTenant } from "@propgate/db";
import { Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import { success } from "../utils/response";

/**
 * `GET /v1/members` — who is on this account.
 *
 * One endpoint, read-only, and deliberately so. `created_by_member_id` on
 * `api_keys` names the member who made each key, and until this existed there was
 * no way to turn that name into anything: the list endpoint reported an address,
 * and nothing said which addresses were supposed to be there.
 *
 * No write operations. Adding a member happens exactly one way — somebody proves
 * control of a mailbox through the signup flow — and removing one needs roles,
 * because without them any member could remove any other, including the founding
 * address. That is the same reasoning that left key revocation ungated in #63,
 * and it points at the same missing piece rather than working around it.
 */

function serialise(member: TenantMember) {
  return {
    createdAt: member.createdAt.toISOString(),
    email: member.email,
    id: member.id,
    object: "member" as const,
  };
}

export function createMembersRoute(options: { db: Database }) {
  const route = new Hono<{ Variables: AuthVariables }>();

  route.get("/", async (c) => {
    const members = await listMembersForTenant(options.db, c.get("tenantId"));

    return success(c, members.map(serialise));
  });

  return route;
}
