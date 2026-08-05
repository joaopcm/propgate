import { asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { tenantMembers } from "../schema/tenant-members";

/**
 * Who is on an account.
 *
 * Read-only, and that is the whole surface for now. There is no invite, no
 * remove, and no role — adding a member is something only the signup flow does,
 * by proving control of a mailbox, and every write here needs the authorisation
 * model that does not exist yet. A `DELETE /v1/members/:id` without roles would
 * let any member remove any other, including the one whose mailbox the account
 * was created from.
 *
 * Reading is different: it answers "who has access", which is a question somebody
 * can act on today by revoking keys, and it exposes nothing a member of the
 * account cannot already infer.
 */

export interface TenantMember {
  readonly createdAt: Date;
  readonly email: string;
  readonly id: string;
}

/** One tenant's members, oldest first — so the founding address leads. */
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
