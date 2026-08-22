import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../client";
import type {
  DomainExpectations,
  DomainResult,
  DomainState,
} from "../schema/domains";
import { domains } from "../schema/domains";
import { recordChanges } from "../schema/record-changes";

export interface DomainRow {
  readonly configChangedAt: Date | null;
  readonly consecutiveFailures: number;
  readonly createdAt: Date;
  readonly expectations: DomainExpectations | null;
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
  configChangedAt: domains.configChangedAt,
  consecutiveFailures: domains.consecutiveFailures,
  createdAt: domains.createdAt,
  expectations: domains.expectations,
  externalId: domains.externalId,
  id: domains.id,
  lastCheckedAt: domains.lastCheckedAt,
  lastResult: domains.lastResult,
  name: domains.name,
  nextCheckAt: domains.nextCheckAt,
  profileVersionId: domains.profileVersionId,
  state: domains.state,
};

const LIST_COLUMNS = {
  configChangedAt: domains.configChangedAt,
  consecutiveFailures: domains.consecutiveFailures,
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

export type RegisterOutcome =
  | { readonly domain: DomainRow; readonly kind: "created" }
  | { readonly domain: DomainRow; readonly kind: "existing" }
  | { readonly existingId: string; readonly kind: "name-taken" };

export async function registerDomain(
  db: Database,
  input: {
    readonly expectations?: DomainExpectations;
    readonly externalId?: string;
    readonly name: string;
    readonly profileVersionId: string;
    readonly tenantId: string;
  },
  now = new Date()
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
      configChangedAt: now,
      ...(input.expectations === undefined
        ? {}
        : { expectations: input.expectations }),
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

export async function updateDomainConfig(
  db: Database,
  tenantId: string,
  id: string,
  changes: {
    readonly expectations?: DomainExpectations;
    readonly profileVersionId?: string;
  },
  now = new Date()
): Promise<DomainRow | undefined> {
  const [row] = await db
    .update(domains)
    .set({
      configChangedAt: now,
      consecutiveFailures: 0,
      ...(changes.expectations === undefined
        ? {}
        : { expectations: changes.expectations }),
      nextCheckAt: now,
      ...(changes.profileVersionId === undefined
        ? {}
        : { profileVersionId: changes.profileVersionId }),
      state: "pending",
    })
    .where(and(eq(domains.tenantId, tenantId), eq(domains.id, id)))
    .returning(COLUMNS);

  return row;
}

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

export async function saveCheck(
  db: Database,
  input: {
    readonly configChangedAt: Date | null;
    readonly consecutiveFailures: number;
    readonly domainId: string;
    readonly nextCheckAt: Date;
    readonly result: DomainResult;
    readonly state: DomainState;
    readonly tenantId: string;
  },
  now = new Date()
): Promise<boolean> {
  const saved = await db
    .update(domains)
    .set({
      consecutiveFailures: input.consecutiveFailures,
      lastCheckedAt: now,
      lastResult: input.result,
      nextCheckAt: input.nextCheckAt,
      state: input.state,
    })
    .where(
      and(
        eq(domains.tenantId, input.tenantId),
        eq(domains.id, input.domainId),
        input.configChangedAt === null
          ? isNull(domains.configChangedAt)
          : eq(domains.configChangedAt, input.configChangedAt)
      )
    )
    .returning({ id: domains.id });

  return saved.length > 0;
}

export type DomainListRow = Omit<DomainRow, "expectations">;

export interface DomainPage {
  readonly domains: readonly DomainListRow[];
  readonly nextCursor: string | null;
}

export async function listDomains(
  db: Database,
  tenantId: string,
  options: {
    readonly cursor?: string;
    readonly externalId?: string;
    readonly limit: number;
    readonly state?: DomainState;
  }
): Promise<DomainPage> {
  const filters = [eq(domains.tenantId, tenantId)];

  if (options.cursor !== undefined) {
    filters.push(gt(domains.id, options.cursor));
  }

  if (options.state !== undefined) {
    filters.push(eq(domains.state, options.state));
  }

  if (options.externalId !== undefined) {
    filters.push(eq(domains.externalId, options.externalId));
  }

  const rows = await db
    .select(LIST_COLUMNS)
    .from(domains)
    .where(and(...filters))
    .orderBy(asc(domains.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);

  return {
    domains: page,
    nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
  };
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
