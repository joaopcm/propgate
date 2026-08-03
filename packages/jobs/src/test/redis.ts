/**
 * A key namespace per spec file, rather than a Redis of its own per package.
 *
 * `packages/db` gives each package its own *database* because its specs truncate
 * from the root of the graph, and two packages pointed at one Postgres means
 * each wiping the other's rows. Redis needs no equivalent, because BullMQ takes
 * a key prefix: two specs with different prefixes cannot see each other's queues
 * even inside one Redis, one database, running at the same time.
 *
 * That is why the `jobs-redis` project keeps `fileParallelism` **on** while
 * `db-postgres` turns it off. The setting belongs to the problem, and here the
 * prefix removes the problem instead of serialising around it. TESTING.md warns
 * against copying `fileParallelism: false` into the DNS specs; this is the same
 * warning pointed at Redis.
 */

const DEFAULT_URL = "redis://127.0.0.1:6389";

let counter = 0;

/**
 * Where the fixture Redis lives.
 *
 * 6389 rather than 6379 for the same reason Postgres is published on 5442: a
 * developer machine often already has one, and colliding with it produces
 * "port is already allocated" with no hint that a host port is the cause.
 */
export function testRedisUrl(): string {
  const url = process.env.REDIS_URL;

  return url === undefined || url === "" ? DEFAULT_URL : url;
}

/**
 * A prefix no other spec will use.
 *
 * The pid separates spec files, which vitest runs in separate workers; the
 * counter separates queues within one file. No randomness, so a failure is
 * reproducible and the key names in a Redis dump are readable.
 */
export function testPrefix(label: string): string {
  counter += 1;

  return `propgate-test-${label}-${process.pid}-${counter}`;
}
