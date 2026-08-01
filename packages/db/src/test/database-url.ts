/**
 * A database of its own, per package.
 *
 * `turbo test` runs packages concurrently, and every Postgres-backed spec here
 * truncates from the root of the graph between tests. Two packages pointed at
 * one database means one of them wiping the other's rows mid-test — a race that
 * passes for as long as the suites stay fast and starts failing, intermittently
 * and somewhere unrelated, the first time one of them slows down.
 *
 * Splitting by name costs one empty database per package and removes the race
 * entirely. `global-setup.ts` creates and migrates whichever one it is pointed
 * at, so nothing has to be provisioned by hand.
 */
const LEADING_SLASH = /^\//;

export function testDatabaseUrl(suffix: string): string {
  // Vitest evaluates a config file more than once per run, and the callers set
  // `DATABASE_URL` to whatever comes back so that globalSetup sees it. Deriving
  // from the mutated value appends the suffix again every time —
  // `propgate_test_api_api_api`. The original is stashed on first call and
  // every derivation afterwards starts from it.
  // Guarded rather than `??=`: assigning `undefined` to a `process.env`
  // property stores the *string* "undefined", which then parses as a relative
  // URL and throws. With no DATABASE_URL set — the default `pnpm test` — that
  // turned every package's config into a startup error.
  if (
    process.env.PROPGATE_DATABASE_BASE_URL === undefined &&
    process.env.DATABASE_URL !== undefined
  ) {
    process.env.PROPGATE_DATABASE_BASE_URL = process.env.DATABASE_URL;
  }

  const base = process.env.PROPGATE_DATABASE_BASE_URL;

  if (base === undefined || base === "") {
    return "";
  }

  const url = new URL(base);

  url.pathname = `/${url.pathname.replace(LEADING_SLASH, "")}_${suffix}`;

  return url.toString();
}
