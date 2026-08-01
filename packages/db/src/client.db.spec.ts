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
