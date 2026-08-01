import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import type { DomainResult, DomainState } from "../schema/domains";
import { domains } from "../schema/domains";
import { recordChanges } from "../schema/record-changes";

export interface DomainRow {
  readonly createdAt: Date;
  readonly externalId: string | null;
  readonly id: string;
  readonly lastCheckedAt: Date | null;
  readonly lastResult: DomainResult | null;
  readonly name: string;
  readonly nextCheckAt: Date | null;
  readonly profileVersionId: string;
  readonly state: DomainState;
}

const COLUMNS = {
  createdAt: domains.createdAt,
  externalId: domains.externalId,
  id: domains.id,
  lastCheckedAt: domains.lastCheckedAt,
  lastResult: domains.lastResult,
  name: domains.name,
  nextCheckAt: domains.nextCheckAt,
  profileVersionId: domains.profileVersionId,
  state: domains.state,
};

/**
 * Registration is idempotent on `external_id`.
 *
 * The partner already has an identifier for the customer this domain belongs
 * to, and re-sending it is what happens when their retry logic fires or their
 * import runs twice. Returning the existing row removes the mapping table on
 * their side and is a friendlier idempotency story than a key they have to
 * generate.
 *
 * A name that already exists under a *different* external id is not idempotent
 * — it is two different records of the same domain, and quietly returning one
 * of them would hide it.
 */
export type RegisterOutcome =
  | { readonly domain: DomainRow; readonly kind: "created" }
  | { readonly domain: DomainRow; readonly kind: "existing" }
  | { readonly existingId: string; readonly kind: "name-taken" };

export async function registerDomain(
  db: Database,
  input: {
    readonly externalId?: string;
    readonly name: string;
    readonly profileVersionId: string;
    readonly tenantId: string;
  }
): Promise<RegisterOutcome> {
  if (input.externalId !== undefined) {
    const existing = await domainByExternalId(
      db,
      input.tenantId,
      input.externalId
    );

    if (existing !== undefined) {
      return { domain: existing, kind: "existing" };
    }
  }

  const takenBy = await domainByName(db, input.tenantId, input.name);

  if (takenBy !== undefined) {
    return { existingId: takenBy.id, kind: "name-taken" };
  }

  const [row] = await db
    .insert(domains)
    .values({
      ...(input.externalId === undefined
        ? {}
        : { externalId: input.externalId }),
      name: input.name,
      profileVersionId: input.profileVersionId,
      tenantId: input.tenantId,
    })
    .returning(COLUMNS);

  if (row === undefined) {
    throw new Error("insert returned no row");
  }

  return { domain: row, kind: "created" };
}

/**
 * Every read is scoped to the tenant in the query itself.
 *
 * Not checked by the caller afterwards: a lookup that can return another
 * tenant's row is a tenancy bug waiting for the one route that forgets, and
 * these are the rows a partner's customers live in.
 */
export async function domainById(
  db: Database,
  tenantId: string,
  id: string
): Promise<DomainRow | undefined> {
  const [row] = await db
    .select(COLUMNS)
    .from(domains)
    .where(and(eq(domains.tenantId, tenantId), eq(domains.id, id)))
    .limit(1);

  return row;
}

export async function domainByName(
  db: Database,
  tenantId: string,
  name: string
): Promise<DomainRow | undefined> {
  const [row] = await db
    .select(COLUMNS)
    .from(domains)
    .where(and(eq(domains.tenantId, tenantId), eq(domains.name, name)))
    .limit(1);

  return row;
}

export async function domainByExternalId(
  db: Database,
  tenantId: string,
  externalId: string
): Promise<DomainRow | undefined> {
  const [row] = await db
    .select(COLUMNS)
    .from(domains)
    .where(
      and(eq(domains.tenantId, tenantId), eq(domains.externalId, externalId))
    )
    .limit(1);

  return row;
}

/** Returns whether anything was deleted, so a route can answer 404 honestly. */
export async function deleteDomain(
  db: Database,
  tenantId: string,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(domains)
    .where(and(eq(domains.tenantId, tenantId), eq(domains.id, id)))
    .returning({ id: domains.id });

  return deleted.length > 0;
}

/**
 * Record a check against a domain: in place, never a row per check.
 *
 * Invariant 3. A row per check is 360k rows a day at ten thousand domains; the
 * only thing that is appended anywhere is a `record_changes` entry, and only
 * when a value actually moved.
 */
export async function saveCheck(
  db: Database,
  input: {
    readonly domainId: string;
    readonly result: DomainResult;
    readonly state: DomainState;
    readonly tenantId: string;
  },
  now = new Date()
): Promise<void> {
  await db
    .update(domains)
    .set({
      lastCheckedAt: now,
      lastResult: input.result,
      state: input.state,
    })
    .where(
      and(eq(domains.tenantId, input.tenantId), eq(domains.id, input.domainId))
    );
}

export interface TimelineEntry {
  readonly current: string | null;
  readonly observedAt: Date;
  readonly previous: string | null;
  readonly requirementKey: string;
}

export async function domainTimeline(
  db: Database,
  domainId: string,
  limit: number
): Promise<readonly TimelineEntry[]> {
  return await db
    .select({
      current: recordChanges.current,
      observedAt: recordChanges.observedAt,
      previous: recordChanges.previous,
      requirementKey: recordChanges.requirementKey,
    })
    .from(recordChanges)
    .where(eq(recordChanges.domainId, domainId))
    .orderBy(desc(recordChanges.id))
    .limit(limit);
}
