import type { Database, TenantMember } from "@propgate/db";
import { listMembersForTenant } from "@propgate/db";
import { Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import { success } from "../utils/response";

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
