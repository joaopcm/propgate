import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { ProfileDefinition } from "../schema/profiles";
import { profiles } from "../schema/profiles";

export interface ProfileVersion {
  readonly definition: ProfileDefinition;
  readonly id: string;
  readonly key: string;
  readonly version: number;
}

/**
 * Write a new version of a profile.
 *
 * Version numbers are sequential per key, which means allocating one is a
 * read-then-write and therefore a race. Two things that do *not* fix it:
 * computing `max(version) + 1` inside the INSERT still lets two concurrent
 * statements read the same maximum, and retrying on the unique violation just
 * runs the same race again — five concurrent creates defeat three attempts, as
 * the spec for this demonstrates.
 *
 * A transaction-scoped advisory lock keyed on the tenant and profile key does
 * fix it, and needs no row to exist first, which the obvious
 * `select ... for update` does. Creating a profile version is a rare
 * administrative act — a partner edits a profile when their sending setup
 * changes, not per request — so serialising it per key costs nothing worth
 * measuring. Two unrelated keys whose hashes collide serialise against each
 * other occasionally; that is also nothing.
 */
export async function createProfileVersion(
  db: Database,
  input: {
    readonly definition: ProfileDefinition;
    readonly key: string;
    readonly tenantId: string;
  }
): Promise<ProfileVersion> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.key}`}, 0))`
    );

    const [current] = await tx
      .select({ version: profiles.version })
      .from(profiles)
      .where(
        and(eq(profiles.tenantId, input.tenantId), eq(profiles.key, input.key))
      )
      .orderBy(desc(profiles.version))
      .limit(1);

    const [row] = await tx
      .insert(profiles)
      .values({
        definition: input.definition,
        key: input.key,
        tenantId: input.tenantId,
        version: (current?.version ?? 0) + 1,
      })
      .returning({
        definition: profiles.definition,
        id: profiles.id,
        key: profiles.key,
        version: profiles.version,
      });

    if (row === undefined) {
      throw new Error("insert returned no row");
    }

    return row;
  });
}

/**
 * The newest version of a profile, scoped to its tenant.
 *
 * The tenant is part of the query rather than something the caller checks
 * afterwards. A lookup that can return another tenant's row and relies on the
 * caller noticing is a tenancy bug waiting for the one caller who forgets.
 */
export async function currentProfileVersion(
  db: Database,
  tenantId: string,
  key: string
): Promise<ProfileVersion | undefined> {
  const [row] = await db
    .select({
      definition: profiles.definition,
      id: profiles.id,
      key: profiles.key,
      version: profiles.version,
    })
    .from(profiles)
    .where(and(eq(profiles.tenantId, tenantId), eq(profiles.key, key)))
    .orderBy(desc(profiles.version))
    .limit(1);

  return row;
}

/** One specific version, by id, scoped to its tenant for the same reason. */
export async function profileVersionById(
  db: Database,
  tenantId: string,
  id: string
): Promise<ProfileVersion | undefined> {
  const [row] = await db
    .select({
      definition: profiles.definition,
      id: profiles.id,
      key: profiles.key,
      version: profiles.version,
    })
    .from(profiles)
    .where(and(eq(profiles.tenantId, tenantId), eq(profiles.id, id)))
    .limit(1);

  return row;
}
