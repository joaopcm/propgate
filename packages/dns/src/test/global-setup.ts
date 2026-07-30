import {
  assertFixturesFresh,
  assertFixturesReady,
} from "@propgate/dns-fixtures";

/**
 * Runs once before the fixture-backed projects.
 *
 * Order matters: reachability first, then freshness. Reporting "stale" when the
 * containers are simply not running would send someone down the wrong path.
 */
export default async function setup(): Promise<void> {
  await assertFixturesReady();
  await assertFixturesFresh();
}
