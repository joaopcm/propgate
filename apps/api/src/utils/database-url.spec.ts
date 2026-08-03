import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requireDatabaseUrl } from "./database-url";

/**
 * The one-shot CLIs must not depend on the server's environment.
 *
 * `migrate` runs before the API and gates the deploy. When it imported the full
 * `env` schema, adding a required `REDIS_URL` for the server stopped migrations
 * dead with a Zod error naming a service migrations never touch — and `keys` and
 * `mint`, both run by hand on the box, failed the same way.
 *
 * The static assertion below is the part that keeps it fixed. The unit tests
 * around it would pass just as happily with the import back in place.
 */

const ONE_SHOT_ENTRY_POINTS = ["keys.ts", "migrate.ts", "mint.ts"];

const ENV_IMPORT = /from\s+"\.\/env"/;

const REQUIRED = /DATABASE_URL is required/;

const original = process.env.DATABASE_URL;

afterEach(() => {
  if (original === undefined) {
    delete process.env.DATABASE_URL;

    return;
  }

  process.env.DATABASE_URL = original;
});

function sourceOf(entryPoint: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${entryPoint}`, import.meta.url)),
    "utf8"
  );
}

describe("requireDatabaseUrl", () => {
  it("returns the configured URL", () => {
    process.env.DATABASE_URL = "postgres://user@host:5432/db";

    expect(requireDatabaseUrl()).toBe("postgres://user@host:5432/db");
  });

  it("names the variable and where to set it when it is missing", () => {
    delete process.env.DATABASE_URL;

    // An operator reading this on a VPS has no stack trace to go on, so the
    // message has to carry the fix.
    expect(() => requireDatabaseUrl()).toThrow(REQUIRED);
  });

  it("treats an empty value as missing", () => {
    // Compose writes an empty string for an unset variable, so `!== undefined`
    // alone would hand an empty connection string to postgres.
    process.env.DATABASE_URL = "";

    expect(() => requireDatabaseUrl()).toThrow(REQUIRED);
  });
});

describe("the one-shot entry points", () => {
  it.each(ONE_SHOT_ENTRY_POINTS)(
    "%s does not import the server environment",
    (entryPoint) => {
      expect(ENV_IMPORT.test(sourceOf(entryPoint))).toBe(false);
    }
  );
});
