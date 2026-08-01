# packages/db Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The persistence layer for monitored domains — schema, migrations, and a real Postgres in the test tier — with no routes and no behaviour beyond what the schema enforces.

**Architecture:** A new `packages/db` workspace holding a Drizzle schema (one file per table, barrelled), a `createDb(connectionString)` factory, and generated SQL migrations. Tests run against a real Postgres from `docker-compose.yml`, gated on an environment variable exactly as the DNS fixture tier is, so a suite that silently skips is impossible.

**Tech Stack:** Drizzle ORM + `postgres` (postgres-js), `drizzle-kit` for migration generation, `uuidv7` for primary keys, Vitest.

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-01-monitored-domains-design.md` and `.claude/CLAUDE.md`. Every task inherits these.

- Text primary keys defaulted with `uuidv7()`. Never serial, never `gen_random_uuid()`.
- A `pgEnum` for domain state carrying **all five** values: `pending`, `verifying`, `verified`, `degraded`, `failed`. Only three are reachable in this milestone; the other two exist so milestone 2 does not migrate an enum.
- `domains.next_check_at` exists now even though nothing reads it. Adding it later means backfilling tens of thousands of rows.
- A domain references a **profile version**, never a profile.
- `record_changes` is append-only, and appended **only** when an observed value actually differs.
- Explicit types on exported function signatures; `unknown` over `any`; `const` by default; early returns.
- Comments explain *why*. No comment restates what the code does.
- `pnpm fix` before every commit. Read the full output of `pnpm exec ultracite check` — do not pipe it through `tail`.
- Nothing in this repo names the design partner. Say "a tenant" or "a partner".

---

### Task 1: The package, the client, and Postgres in the test tier

Nothing here is domain logic. It exists so Task 2 has somewhere to put a table and something to run a test against.

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/test/global-setup.ts`
- Create: `packages/db/src/client.db.spec.ts`
- Modify: `docker-compose.yml`
- Modify: `turbo.json`
- Modify: `TESTING.md`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Produces: `createDb(connectionString: string, opts?: { maxConnections?: number }): Database`, `type Database`, and `schema` re-exported from `packages/db/src/index.ts`. Tasks 2–5 add tables to `src/schema/` and re-export them from `src/schema/index.ts`.
- Produces: the `db` Vitest project name and the `PROPGATE_DATABASE` gate, both used by every later `*.db.spec.ts`.

- [ ] **Step 1: Create the package manifest**

`packages/db/package.json`:

```json
{
  "name": "@propgate/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.2",
    "postgres": "^3",
    "uuidv7": "^1.2.1"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "drizzle-kit": "^0.31.10",
    "typescript": "^5.7",
    "vitest": "^4"
  }
}
```

`packages/db/tsconfig.json` — copy `packages/dns/tsconfig.json` verbatim. It already sets `noUncheckedIndexedAccess` and `verbatimModuleSyntax`, which this package needs for the same reasons.

- [ ] **Step 2: Add the Postgres service**

In `docker-compose.yml`, alongside the DNS services:

```yaml
  postgres:
    image: postgres:17-alpine
    # A published port, not host networking — and the difference from the DNS
    # services is deliberate. Those need real port 53 on distinct loopbacks
    # because glue records carry no port field. Postgres has no such
    # constraint, and host networking here only means fighting whatever already
    # owns 5432 on the developer's machine.
    ports:
      - "127.0.0.1:5442:5432"
    environment:
      POSTGRES_USER: propgate
      POSTGRES_PASSWORD: propgate
      POSTGRES_DB: propgate_test
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U propgate -d propgate_test"]
      interval: 2s
      timeout: 3s
      retries: 15
```

- [ ] **Step 3: Write the drizzle config**

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema/index.ts",
});
```

- [ ] **Step 4: Write the client**

`packages/db/src/client.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// biome-ignore lint/performance/noNamespaceImport: drizzle takes the schema as a namespace
import * as schema from "./schema";

/**
 * A connection pool and a typed query builder over it.
 *
 * A factory rather than a module-level singleton: the API process wants one
 * long-lived pool, and every spec wants its own so that closing one cannot
 * strand another. A singleton read from the environment at import time makes
 * both of those the same object.
 */
export function createDb(
  connectionString: string,
  opts?: { maxConnections?: number }
) {
  const client = postgres(connectionString, {
    max: opts?.maxConnections ?? 10,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

`packages/db/src/schema/index.ts` starts empty apart from a comment, because Task 2 fills it:

```ts
// biome-ignore-all lint/performance/noBarrelFile: drizzle resolves the schema through one namespace
```

`packages/db/src/index.ts`:

```ts
// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point
export type { Database } from "./client";
export { createDb } from "./client";
```

- [ ] **Step 5: Write the global setup that refuses to skip silently**

`packages/db/src/test/global-setup.ts`:

```ts
import postgres from "postgres";

/**
 * Fails loudly when the database is missing.
 *
 * The same rule the DNS tier follows: gate on an environment variable rather
 * than on reachability, because a suite that skips when the server is down
 * looks exactly like a suite that passed. When the flag is set and Postgres is
 * not there, say so with the command that fixes it.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === "") {
    throw new Error(
      "PROPGATE_DATABASE=1 but DATABASE_URL is unset. Run `pnpm db:up`."
    );
  }

  const client = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await client`select 1`;
  } catch (cause) {
    throw new Error(
      `Postgres unreachable at ${url} — run \`pnpm db:up\`. (${String(cause)})`
    );
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 6: Write the vitest config with the gate**

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

/**
 * Two projects, split by what they need — the same shape as `packages/dns`.
 *
 * `db` — anything pure. Runs anywhere.
 *
 * `db-postgres` — specs that touch a real database, gated on
 * PROPGATE_DATABASE. `fileParallelism` is OFF here and only here: a shared
 * Postgres is mutable state and parallel files trample each other. TESTING.md
 * warns against copying that setting into the DNS specs, where the fixtures are
 * read-only and nothing contends. The warning runs both ways.
 */
const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.db.spec.ts"],
      include: ["src/**/*.spec.ts"],
      name: "db",
    },
  },
];

if (process.env.PROPGATE_DATABASE === "1") {
  projects.push({
    extends: true,
    test: {
      fileParallelism: false,
      globalSetup: ["./src/test/global-setup.ts"],
      include: ["src/**/*.db.spec.ts"],
      name: "db-postgres",
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
```

- [ ] **Step 7: Declare the environment variables to turbo**

In `turbo.json`, add to `tasks.test.env`:

```
"PROPGATE_DATABASE",
"DATABASE_URL"
```

This is not optional bookkeeping. Turbo strips variables a task does not declare, and that is exactly how the DNS fixture job went green for two PRs while running no fixture tests at all (fixed in #11). An undeclared flag is a silently disabled test suite.

Add root scripts to the top-level `package.json`:

```json
"db:up": "docker compose up -d --wait postgres",
"db:down": "docker compose stop postgres"
```

- [ ] **Step 8: Write the failing connection test**

`packages/db/src/client.db.spec.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client";

/**
 * Proves the tier is wired: a real connection, a real round trip. If this fails
 * the problem is the harness, not the schema, and every later spec would fail
 * in a way that looks like a schema bug.
 */

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

afterAll(async () => {
  await db.$client.end();
});

describe("the database", () => {
  it("answers a query", async () => {
    const rows = await db.execute(sql`select 1 as one`);

    expect(rows[0]).toEqual({ one: 1 });
  });
});
```

- [ ] **Step 9: Run it and watch it fail for the right reason**

```sh
pnpm install
PROPGATE_DATABASE=1 pnpm --filter @propgate/db exec vitest run --project db-postgres
```

Expected: a failure naming `DATABASE_URL` as unset, from the global setup — **not** a connection refused and not a missing module. If the message is anything else, the gate is wired wrong and fixing that now is the whole point of this task.

- [ ] **Step 10: Bring Postgres up and make it pass**

```sh
pnpm db:up
DATABASE_URL=postgres://propgate:propgate@127.0.0.1:5442/propgate_test \
  PROPGATE_DATABASE=1 pnpm --filter @propgate/db exec vitest run --project db-postgres
```

Expected: 1 passed.

Then confirm the gate is closed by default — this must find no `db-postgres` project at all:

```sh
pnpm --filter @propgate/db exec vitest run --project db-postgres
```

- [ ] **Step 11: Add the CI job**

In `.github/workflows/test.yml`, the `fixtures` job already runs `docker compose up -d --build --wait`. Change it to bring up Postgres too and export both variables, then add the tripwire alongside the existing two:

```yaml
      - name: Assert the fixture-backed specs actually ran
        env:
          PROPGATE_FIXTURES: "1"
          PROPGATE_DATABASE: "1"
          DATABASE_URL: postgres://propgate:propgate@127.0.0.1:5442/propgate_test
        run: |
          pnpm --filter @propgate/dns exec vitest run --project dns-fixtures
          pnpm --filter @propgate/api exec vitest run --project api-fixtures
          pnpm --filter @propgate/cli exec vitest run --project cli-fixtures
          pnpm --filter @propgate/db exec vitest run --project db-postgres
```

- [ ] **Step 12: Document the divergence in TESTING.md**

Under the existing "fileParallelism stays on — and why that differs from Postgres" heading, add:

```markdown
As of `packages/db` the comparison is no longer hypothetical. The `db-postgres`
project **does** set `fileParallelism: false`, because a shared Postgres is
exactly the mutable state that section describes. The rule is unchanged: the
setting belongs to the project that needs it, and copying it in either
direction is the mistake.
```

- [ ] **Step 13: Verify and commit**

```sh
pnpm fix
pnpm exec ultracite check
pnpm lint
pnpm test
PROPGATE_FIXTURES=1 PROPGATE_DATABASE=1 \
  DATABASE_URL=postgres://propgate:propgate@127.0.0.1:5442/propgate_test pnpm test
pnpm build
```

Read each command's full output.

```sh
git add -A
git commit -m "feat(db): package skeleton and Postgres in the test tier

Gated on PROPGATE_DATABASE and declared in turbo.json's test.env, because an
undeclared variable is a silently disabled suite — which is how the DNS fixture
job went green for two PRs while running nothing.

fileParallelism is off for db-postgres and only there. TESTING.md's warning
against copying that setting into the DNS specs now runs both ways."
```

---

### Task 2: Tenants and API keys

**Files:**
- Create: `packages/db/src/schema/tenants.ts`
- Create: `packages/db/src/schema/api-keys.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/test/truncate.ts`
- Create: `packages/db/src/schema/tenants.db.spec.ts`

**Interfaces:**
- Consumes: `createDb`, `Database` from Task 1.
- Produces: `tenants` and `apiKeys` Drizzle tables; `truncateAll(db: Database): Promise<void>` used by every later `*.db.spec.ts`.

- [ ] **Step 1: Write the tenants table**

`packages/db/src/schema/tenants.ts`:

```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const tenants = pgTable("tenants", {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text("name").notNull(),
});
```

- [ ] **Step 2: Write the api_keys table**

`packages/db/src/schema/api-keys.ts`:

```ts
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenants } from "./tenants";

/**
 * Only the hash is stored. `prefix` is the leading characters kept in clear so
 * a key can be identified in a list without being reconstructible from the
 * row — losing the database must not lose the keys.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    hashedKey: text("hashed_key").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    lastUsedAt: timestamp("last_used_at"),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    revokedAt: timestamp("revoked_at"),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("api_keys_hashed_key_idx").on(table.hashedKey),
    index("api_keys_tenant_id_idx").on(table.tenantId),
  ]
);
```

Add both to `packages/db/src/schema/index.ts`:

```ts
export { apiKeys } from "./api-keys";
export { tenants } from "./tenants";
```

- [ ] **Step 3: Write the truncate helper**

`packages/db/src/test/truncate.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Database } from "../client";

/**
 * Empty every table between tests.
 *
 * `TRUNCATE ... CASCADE` in one statement rather than a delete per table: it is
 * one round trip, it does not care about foreign-key order, and it cannot leave
 * half the tables cleared if it fails partway.
 */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table ${sql.identifier("tenants")} restart identity cascade`
  );
}
```

- [ ] **Step 4: Write the failing test**

`packages/db/src/schema/tenants.db.spec.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { truncateAll } from "../test/truncate";
import { apiKeys } from "./api-keys";
import { tenants } from "./tenants";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("tenants and keys", () => {
  it("gives every row a sortable id without being told", async () => {
    // uuidv7 is time-ordered, so inserting in sequence yields ids that sort in
    // insertion order. That is why it is worth having over a random uuid.
    const [first] = await db
      .insert(tenants)
      .values({ name: "one" })
      .returning();
    const [second] = await db
      .insert(tenants)
      .values({ name: "two" })
      .returning();

    expect(first?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(String(first?.id) < String(second?.id)).toBe(true);
  });

  it("refuses two keys with the same hash", async () => {
    const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
    const row = {
      hashedKey: "same",
      name: "k",
      prefix: "pg_live_aaaa",
      tenantId: String(tenant?.id),
    };

    await db.insert(apiKeys).values(row);

    await expect(db.insert(apiKeys).values(row)).rejects.toThrow();
  });

  it("takes a tenant's keys with it when the tenant goes", async () => {
    // Cascade rather than a nullable tenant: a key with no tenant authenticates
    // as nobody, and every later query would have to decide what that means.
    const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
    const tenantId = String(tenant?.id);

    await db
      .insert(apiKeys)
      .values({ hashedKey: "h", name: "k", prefix: "pg_live_bbbb", tenantId });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    expect(await db.select().from(apiKeys)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```sh
DATABASE_URL=postgres://propgate:propgate@127.0.0.1:5442/propgate_test \
  PROPGATE_DATABASE=1 pnpm --filter @propgate/db exec vitest run --project db-postgres
```

Expected: failure with `relation "tenants" does not exist`. The schema is written but no migration has been generated, which is the point of the next step.

- [ ] **Step 6: Generate and apply the migration**

```sh
cd packages/db
DATABASE_URL=postgres://propgate:propgate@127.0.0.1:5442/propgate_test pnpm db:generate
DATABASE_URL=postgres://propgate:propgate@127.0.0.1:5442/propgate_test pnpm db:migrate
```

Read the generated SQL in `packages/db/drizzle/` before applying it. Confirm text primary keys, the unique index on `hashed_key`, and `on delete cascade` on the tenant reference. A generated migration nobody read is a schema nobody designed.

- [ ] **Step 7: Run the tests and see them pass**

Expected: 3 passed.

- [ ] **Step 8: Verify and commit**

```sh
pnpm fix && pnpm exec ultracite check && pnpm lint
git add -A
git commit -m "feat(db): tenants and API keys

Only the hash is stored, with a prefix kept in clear so a key is identifiable in
a list without being reconstructible from the row. Keys cascade with their
tenant: a key with no tenant authenticates as nobody, and every later query
would have to decide what that means."
```

---

### Task 3: Versioned profiles

**Files:**
- Create: `packages/db/src/schema/profiles.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/profiles.db.spec.ts`

**Interfaces:**
- Consumes: `tenants` from Task 2.
- Produces: the `profiles` table and `type ProfileDefinition`. Task 4's `domains.profileVersionId` references `profiles.id`.

- [ ] **Step 1: Write the table**

`packages/db/src/schema/profiles.ts`:

```ts
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenants } from "./tenants";

/**
 * One requirement of a tenant's record set, with a stable key so a result can
 * be reported against it rather than against a check kind.
 *
 * Deliberately limited to what the evaluators already assert. A requirement
 * nobody can evaluate is a promise the API cannot keep.
 */
export interface ProfileRequirement {
  readonly caaIssuer?: string;
  readonly check: "caa" | "delegation" | "dkim" | "dmarc" | "mx" | "spf";
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly selector?: string;
}

export interface ProfileDefinition {
  readonly requirements: readonly ProfileRequirement[];
}

/**
 * A profile *version*. Editing a profile writes a new row.
 *
 * Domains pin the version they were registered against, so an edit cannot
 * silently reclassify every domain using it — which in milestone 2 would arrive
 * as a webhook storm with no deploy behind it.
 */
export const profiles = pgTable(
  "profiles",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    definition: jsonb("definition").$type<ProfileDefinition>().notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    key: text("key").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("profiles_tenant_key_version_idx").on(
      table.tenantId,
      table.key,
      table.version
    ),
  ]
);
```

Export it from `src/schema/index.ts`.

- [ ] **Step 2: Write the failing test**

`packages/db/src/schema/profiles.db.spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { truncateAll } from "../test/truncate";
import type { ProfileDefinition } from "./profiles";
import { profiles } from "./profiles";
import { tenants } from "./tenants";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

const DEFINITION: ProfileDefinition = {
  requirements: [
    { check: "spf", include: "_spf.partner.example", key: "spf" },
    { check: "dkim", key: "dkim", selector: "pg1" },
  ],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(): Promise<string> {
  const [row] = await db.insert(tenants).values({ name: "t" }).returning();

  return String(row?.id);
}

describe("profiles", () => {
  it("keeps every version rather than overwriting", async () => {
    const tenantId = await tenant();

    await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 });
    await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId, version: 2 });

    expect(await db.select().from(profiles)).toHaveLength(2);
  });

  it("refuses the same version twice for one key", async () => {
    const tenantId = await tenant();
    const row = { definition: DEFINITION, key: "sending", tenantId, version: 1 };

    await db.insert(profiles).values(row);

    await expect(db.insert(profiles).values(row)).rejects.toThrow();
  });

  it("lets two tenants use the same profile key", async () => {
    // The key is a tenant's own name for the profile, not a global identifier.
    // Making it globally unique would mean the second tenant to want "sending"
    // could not have it.
    const first = await tenant();
    const second = await tenant();

    await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId: first, version: 1 });
    await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId: second, version: 1 });

    expect(await db.select().from(profiles)).toHaveLength(2);
  });

  it("round-trips the definition without losing its shape", async () => {
    const tenantId = await tenant();

    const [row] = await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
      .returning();

    expect(row?.definition.requirements[0]?.include).toBe(
      "_spf.partner.example"
    );
  });
});
```

- [ ] **Step 3: Run it, watch it fail on the missing relation, generate the migration, apply it, run it again**

```sh
cd packages/db
DATABASE_URL=… pnpm db:generate && DATABASE_URL=… pnpm db:migrate
```

Read the SQL before applying. Expected afterwards: 4 passed.

- [ ] **Step 4: Verify and commit**

```sh
pnpm fix && pnpm exec ultracite check && pnpm lint
git add -A
git commit -m "feat(db): versioned profiles

Editing a profile writes a new row. Domains pin the version they were
registered against, so an edit cannot silently reclassify every domain using it
— which in milestone 2 arrives as a webhook storm with no deploy behind it.

The profile key is unique per tenant, not globally: it is a tenant's own name
for the profile, and the second tenant to want \"sending\" should be able to
have it."
```

---

### Task 4: Domains

**Files:**
- Create: `packages/db/src/schema/domains.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/domains.db.spec.ts`

**Interfaces:**
- Consumes: `tenants` (Task 2), `profiles` (Task 3).
- Produces: the `domains` table, `domainState` pgEnum, and `type DomainState`. Task 5's `record_changes` references `domains.id`.

- [ ] **Step 1: Write the table**

`packages/db/src/schema/domains.ts`:

```ts
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { profiles } from "./profiles";
import { tenants } from "./tenants";

/**
 * All five states exist from the first migration.
 *
 * This milestone can only reach `pending`, `verified` and `failed` — checks are
 * synchronous, so nothing observes `verifying`, and `degraded` needs the
 * hysteresis that arrives with the sweeper. They are here so milestone 2 adds a
 * transition rather than migrating an enum under live rows.
 */
export const domainState = pgEnum("domain_state", [
  "pending",
  "verifying",
  "verified",
  "degraded",
  "failed",
]);

export type DomainState = (typeof domainState.enumValues)[number];

/** One requirement's outcome, as stored. Mirrors what the API returns. */
export interface RequirementResult {
  readonly findings: readonly {
    readonly code: string;
    readonly expected?: string;
    readonly observed?: string;
  }[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: "pass" | "warn" | "indeterminate" | "fail";
}

export interface DomainResult {
  readonly checkedAt: string;
  readonly requirements: readonly RequirementResult[];
  readonly verdict: "pass" | "warn" | "indeterminate" | "fail";
}

export const domains = pgTable(
  "domains",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    externalId: text("external_id"),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Updated in place. Never a row per check — that is invariant 3. */
    lastCheckedAt: timestamp("last_checked_at"),
    lastResult: jsonb("last_result").$type<DomainResult>(),
    name: text("name").notNull(),
    /**
     * Nothing reads this yet. It is the column the sweeper's query will be
     * built on, and adding it later means backfilling every row.
     */
    nextCheckAt: timestamp("next_check_at"),
    profileVersionId: text("profile_version_id")
      .notNull()
      .references(() => profiles.id),
    state: domainState("state").default("pending").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("domains_tenant_name_idx").on(table.tenantId, table.name),
    uniqueIndex("domains_tenant_external_id_idx").on(
      table.tenantId,
      table.externalId
    ),
    // The sweeper's query, in index form, before the sweeper exists.
    index("domains_state_next_check_at_idx").on(table.state, table.nextCheckAt),
  ]
);
```

Export from `src/schema/index.ts`.

- [ ] **Step 2: Write the failing test**

`packages/db/src/schema/domains.db.spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { truncateAll } from "../test/truncate";
import { domains } from "./domains";
import type { ProfileDefinition } from "./profiles";
import { profiles } from "./profiles";
import { tenants } from "./tenants";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

const DEFINITION: ProfileDefinition = {
  requirements: [{ check: "spf", include: "_spf.partner.example", key: "spf" }],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function fixture(): Promise<{ profileId: string; tenantId: string }> {
  const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
  const tenantId = String(tenant?.id);
  const [profile] = await db
    .insert(profiles)
    .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
    .returning();

  return { profileId: String(profile?.id), tenantId };
}

describe("domains", () => {
  it("starts pending without being told", async () => {
    const { profileId, tenantId } = await fixture();

    const [row] = await db
      .insert(domains)
      .values({ name: "example.com", profileVersionId: profileId, tenantId })
      .returning();

    expect(row?.state).toBe("pending");
    expect(row?.lastCheckedAt).toBeNull();
    expect(row?.nextCheckAt).toBeNull();
  });

  it("accepts all five states, including the two nothing reaches yet", async () => {
    // The enum exists in full from the first migration so milestone 2 adds a
    // transition rather than migrating an enum under live rows.
    const { profileId, tenantId } = await fixture();

    for (const state of [
      "pending",
      "verifying",
      "verified",
      "degraded",
      "failed",
    ] as const) {
      const [row] = await db
        .insert(domains)
        .values({
          name: `${state}.example.com`,
          profileVersionId: profileId,
          state,
          tenantId,
        })
        .returning();

      expect(row?.state).toBe(state);
    }
  });

  it("refuses the same name twice for one tenant", async () => {
    const { profileId, tenantId } = await fixture();
    const row = {
      name: "example.com",
      profileVersionId: profileId,
      tenantId,
    };

    await db.insert(domains).values(row);

    await expect(db.insert(domains).values(row)).rejects.toThrow();
  });

  it("lets two tenants watch the same domain", async () => {
    // Two platforms can legitimately both be verifying one customer's domain,
    // and neither should be able to detect the other.
    const first = await fixture();
    const second = await fixture();

    await db.insert(domains).values({
      name: "example.com",
      profileVersionId: first.profileId,
      tenantId: first.tenantId,
    });
    await db.insert(domains).values({
      name: "example.com",
      profileVersionId: second.profileId,
      tenantId: second.tenantId,
    });

    expect(await db.select().from(domains)).toHaveLength(2);
  });

  it("refuses a duplicate external id within a tenant", async () => {
    const { profileId, tenantId } = await fixture();

    await db.insert(domains).values({
      externalId: "cust_1",
      name: "a.example.com",
      profileVersionId: profileId,
      tenantId,
    });

    await expect(
      db.insert(domains).values({
        externalId: "cust_1",
        name: "b.example.com",
        profileVersionId: profileId,
        tenantId,
      })
    ).rejects.toThrow();
  });

  it("allows many domains with no external id at all", async () => {
    // Postgres treats NULLs as distinct in a unique index, which is the
    // behaviour we want: external_id is optional and two domains without one
    // are not duplicates.
    const { profileId, tenantId } = await fixture();

    await db.insert(domains).values({
      name: "a.example.com",
      profileVersionId: profileId,
      tenantId,
    });
    await db.insert(domains).values({
      name: "b.example.com",
      profileVersionId: profileId,
      tenantId,
    });

    expect(await db.select().from(domains)).toHaveLength(2);
  });

  it("will not let a profile version be deleted out from under a domain", async () => {
    // No cascade here on purpose: a domain pinned to a version that vanished
    // cannot be re-evaluated, and losing that silently is worse than an error.
    const { profileId, tenantId } = await fixture();

    await db.insert(domains).values({
      name: "example.com",
      profileVersionId: profileId,
      tenantId,
    });

    await expect(db.delete(profiles)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Generate the migration, read the SQL, apply, run**

Confirm the enum is created with all five labels and that `profile_version_id` has **no** `on delete cascade`. Expected: 7 passed.

- [ ] **Step 4: Verify and commit**

```sh
pnpm fix && pnpm exec ultracite check && pnpm lint
git add -A
git commit -m "feat(db): domains, with two columns nothing reads yet

next_check_at is the column the sweeper's query will be built on; adding it
later means backfilling every row. The state enum carries all five values so
milestone 2 adds a transition rather than migrating an enum under live rows.

A domain pins a profile version and the reference does not cascade: a domain
pinned to a version that vanished cannot be re-evaluated, and losing that
silently is worse than an error."
```

---

### Task 5: Record changes, appended only on change

This is the table the whole milestone exists to get right.

**Files:**
- Create: `packages/db/src/schema/record-changes.ts`
- Create: `packages/db/src/queries/record-changes.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/queries/record-changes.db.spec.ts`

**Interfaces:**
- Consumes: `domains` (Task 4), `Database` (Task 1).
- Produces: `recordChanges` table and
  `recordObservation(db: Database, input: { domainId: string; requirementKey: string; observed: string | null }): Promise<"unchanged" | "changed">`,
  exported from the package entry point for the API to use in step 4 of the milestone.

- [ ] **Step 1: Write the table**

`packages/db/src/schema/record-changes.ts`:

```ts
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { domains } from "./domains";

/**
 * Append-only, and appended *only* when an observed value actually differs.
 *
 * Writing a row per check is 360k rows a day at ten thousand domains and turns
 * a $20 bill into a $400 one — invariant 3 in `.claude/CLAUDE.md`. `previous`
 * is null for the first observation of a requirement, which is how "we saw this
 * for the first time" is told apart from "it changed to this".
 */
export const recordChanges = pgTable(
  "record_changes",
  {
    current: text("current"),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    observedAt: timestamp("observed_at").defaultNow().notNull(),
    previous: text("previous"),
    requirementKey: text("requirement_key").notNull(),
  },
  (table) => [
    index("record_changes_domain_observed_idx").on(
      table.domainId,
      table.observedAt
    ),
  ]
);
```

- [ ] **Step 2: Write the failing test first — before the query**

`packages/db/src/queries/record-changes.db.spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { domains } from "../schema/domains";
import type { ProfileDefinition } from "../schema/profiles";
import { profiles } from "../schema/profiles";
import { recordChanges } from "../schema/record-changes";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { recordObservation } from "./record-changes";

/**
 * The write pattern this milestone exists to prove. Everything else in
 * packages/db is a table; this is the rule that keeps the bill at $20.
 */

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

const DEFINITION: ProfileDefinition = {
  requirements: [{ check: "spf", include: "_spf.partner.example", key: "spf" }],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function domain(): Promise<string> {
  const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
  const tenantId = String(tenant?.id);
  const [profile] = await db
    .insert(profiles)
    .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
    .returning();
  const [row] = await db
    .insert(domains)
    .values({
      name: "example.com",
      profileVersionId: String(profile?.id),
      tenantId,
    })
    .returning();

  return String(row?.id);
}

describe("recordObservation", () => {
  it("appends the first sighting with no previous value", async () => {
    const domainId = await domain();

    const outcome = await recordObservation(db, {
      domainId,
      observed: "v=spf1 include:a -all",
      requirementKey: "spf",
    });

    const rows = await db.select().from(recordChanges);

    expect(outcome).toBe("changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previous).toBeNull();
    expect(rows[0]?.current).toBe("v=spf1 include:a -all");
  });

  it("writes nothing when the value is unchanged", async () => {
    // The assertion the bill depends on. A sweep that observes the same value
    // six times a day must not write six rows.
    const domainId = await domain();
    const observed = "v=spf1 include:a -all";

    await recordObservation(db, { domainId, observed, requirementKey: "spf" });
    const outcome = await recordObservation(db, {
      domainId,
      observed,
      requirementKey: "spf",
    });

    expect(outcome).toBe("unchanged");
    expect(await db.select().from(recordChanges)).toHaveLength(1);
  });

  it("appends when the value actually changes, carrying the old one", async () => {
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: "old",
      requirementKey: "spf",
    });
    await recordObservation(db, {
      domainId,
      observed: "new",
      requirementKey: "spf",
    });

    const rows = await db
      .select()
      .from(recordChanges)
      .orderBy(recordChanges.id);

    expect(rows).toHaveLength(2);
    expect(rows[1]?.previous).toBe("old");
    expect(rows[1]?.current).toBe("new");
  });

  it("treats a record disappearing as a change", async () => {
    // Deletion is the change people most want to see in a timeline, and a null
    // observation is how it arrives.
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: "something",
      requirementKey: "spf",
    });
    const outcome = await recordObservation(db, {
      domainId,
      observed: null,
      requirementKey: "spf",
    });

    expect(outcome).toBe("changed");
    expect(await db.select().from(recordChanges)).toHaveLength(2);
  });

  it("does not append twice for a value that stays absent", async () => {
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: null,
      requirementKey: "spf",
    });
    const outcome = await recordObservation(db, {
      domainId,
      observed: null,
      requirementKey: "spf",
    });

    expect(outcome).toBe("unchanged");
    expect(await db.select().from(recordChanges)).toHaveLength(1);
  });

  it("keeps requirements independent", async () => {
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: "x",
      requirementKey: "spf",
    });
    await recordObservation(db, {
      domainId,
      observed: "x",
      requirementKey: "dkim",
    });

    // Same value, different requirement — two first sightings, not a no-op.
    expect(await db.select().from(recordChanges)).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Expected: a module-not-found for `./record-changes`, then once the file exists, `relation "record_changes" does not exist`.

- [ ] **Step 4: Write the query**

`packages/db/src/queries/record-changes.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { recordChanges } from "../schema/record-changes";

export interface Observation {
  readonly domainId: string;
  /** Null when the record is absent, which is itself a change worth recording. */
  readonly observed: string | null;
  readonly requirementKey: string;
}

/**
 * Append an observation, but only if it differs from the last one.
 *
 * Reads the most recent row for the requirement and compares before writing.
 * The read costs an indexed lookup; the alternative costs a row per
 * requirement per sweep, forever.
 */
export async function recordObservation(
  db: Database,
  input: Observation
): Promise<"changed" | "unchanged"> {
  const [latest] = await db
    .select({ current: recordChanges.current })
    .from(recordChanges)
    .where(
      and(
        eq(recordChanges.domainId, input.domainId),
        eq(recordChanges.requirementKey, input.requirementKey)
      )
    )
    .orderBy(desc(recordChanges.id))
    .limit(1);

  if (latest !== undefined && latest.current === input.observed) {
    return "unchanged";
  }

  await db.insert(recordChanges).values({
    current: input.observed,
    domainId: input.domainId,
    previous: latest?.current ?? null,
    requirementKey: input.requirementKey,
  });

  return "changed";
}
```

Export the table from `src/schema/index.ts`, and from `src/index.ts`:

```ts
export type { Observation } from "./queries/record-changes";
export { recordObservation } from "./queries/record-changes";
```

- [ ] **Step 5: Generate the migration, read the SQL, apply, run**

Expected: 6 passed.

- [ ] **Step 6: Full verification**

```sh
pnpm fix
pnpm exec ultracite check
pnpm lint
pnpm test
PROPGATE_FIXTURES=1 PROPGATE_DATABASE=1 \
  DATABASE_URL=postgres://propgate:propgate@127.0.0.1:5442/propgate_test pnpm test
pnpm build
```

Read every output in full.

- [ ] **Step 7: Commit**

```sh
git add -A
git commit -m "feat(db): record changes, appended only on change

The write pattern the milestone exists to prove. A sweep that observes the same
value six times a day must write nothing — a row per check is 360k rows a day at
ten thousand domains and turns a \$20 bill into a \$400 one.

A null observation is a change: a record disappearing is the thing people most
want to see in a timeline. Two consecutive absences are not."
```

---

## Self-Review

**Spec coverage.** Every table in the spec's data model has a task: `tenants` and `api_keys` (2), `profiles` (3), `domains` (4), `record_changes` (5). Both "columns that exist before anything reads them" are in Task 4 with tests. The change-only write rule is Task 5. Postgres in the test tier and the `fileParallelism` divergence are Task 1. Nothing in the spec's *data model or testing* sections is unassigned.

Out of scope by design, and correctly absent: routes, authentication logic, profile compilation, the DKIM per-selector split. Those are steps 2–4 of the milestone.

**Placeholders.** None. Every step carries the code it needs.

**Type consistency.** `Database` (Task 1) is the first parameter of `truncateAll` (2) and `recordObservation` (5). `ProfileDefinition` (3) is the `$type` of `profiles.definition` and is imported by the specs in 4 and 5. `domains.profileVersionId` references `profiles.id` (3→4); `recordChanges.domainId` references `domains.id` (4→5). `recordObservation` returns `"changed" | "unchanged"` in the interface block, the test, and the implementation.

**One thing deliberately left to the implementer.** `truncateAll` truncates `tenants` with `cascade`, which reaches every other table through the foreign keys as they exist today. If a future table hangs off nothing, it will not be cleared. Adding it to the truncate list is a one-line change and the alternative — enumerating tables — drifts silently the moment someone forgets.
