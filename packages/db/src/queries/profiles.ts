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
