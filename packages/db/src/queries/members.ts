import { asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { tenantMembers } from "../schema/tenant-members";

export interface TenantMember {
  readonly createdAt: Date;
  readonly email: string;
  readonly id: string;
}

export async function listMembersForTenant(
  db: Database,
  tenantId: string
): Promise<readonly TenantMember[]> {
  return await db
    .select({
      createdAt: tenantMembers.createdAt,
      email: tenantMembers.email,
      id: tenantMembers.id,
    })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId))
    .orderBy(asc(tenantMembers.createdAt), asc(tenantMembers.id));
}
