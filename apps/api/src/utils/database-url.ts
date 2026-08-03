/**
 * The one variable the one-shot entry points need.
 *
 * `migrate.ts`, `keys.ts` and `mint.ts` are CLIs bundled into the same image as
 * the server, and they touch nothing but Postgres. Importing the full `env`
 * schema made them fail on every variable the *server* requires: adding
 * `REDIS_URL` broke the migrate container, which runs before the API and gates
 * the deploy, with a Zod error naming a service migrations do not use.
 *
 * Same shape as the fix that moved the wired app out of `app.ts`. A module
 * should read the environment it uses and no more, or every addition to the
 * schema is a chance to break something unrelated.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is required. Set it in the environment of whichever container is running this command."
    );
  }

  return url;
}
