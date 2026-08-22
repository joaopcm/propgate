import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requireDatabaseUrl } from "./database-url";

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

    expect(() => requireDatabaseUrl()).toThrow(REQUIRED);
  });

  it("treats an empty value as missing", () => {
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
