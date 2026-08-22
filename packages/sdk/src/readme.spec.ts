import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Propgate } from "./client";

const README = readFileSync(
  join(dirname(dirname(fileURLToPath(import.meta.url))), "README.md"),
  "utf8"
);

const client = new Propgate("pg_readme_key");

const RESOURCES = [
  "apiKeys",
  "checks",
  "domains",
  "members",
  "profiles",
  "webhooks",
] as const;

function methods(): readonly string[] {
  const found = RESOURCES.flatMap((resource) => {
    const prototype = Object.getPrototypeOf(client[resource]) as object;

    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .map((name) => `${resource}.${name}`);
  });

  return [...found, "health"];
}

describe("the published README", () => {
  it("shows every method the client exposes", () => {
    const undocumented = methods().filter(
      (method) => !README.includes(`propgate.${method}(`)
    );

    expect(undocumented).toEqual([]);
  });

  it("names the default base URL that a caller gets without configuring one", () => {
    expect(README).toContain("https://api.propgate.dev");
  });

  it("says where the key is read from when none is passed", () => {
    expect(README).toContain("PROPGATE_API_KEY");
  });
});
