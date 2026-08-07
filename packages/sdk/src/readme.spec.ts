import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Propgate } from "./client";

/**
 * The published README, against the client it describes.
 *
 * The README is the package page: it is the first thing anyone reads and the
 * one artefact nobody re-runs. `@propgate/cli` guards its usage block the same
 * way, after it went two check kinds out of date without anything noticing.
 *
 * A method the README does not mention is a method customers do not know exists,
 * which is the same outcome as not shipping it. This asserts presence, not
 * formatting — the prose around each call is free to change.
 */

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

/**
 * Every public method, found by reflection rather than by a list.
 *
 * A hand-kept list here would only prove that this file agrees with itself, and
 * the failure being guarded against is precisely somebody adding a method and
 * not the paragraph.
 */
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
    // The message a missing key produces names this variable, and a README that
    // does not mention it makes that message look like an internal detail.
    expect(README).toContain("PROPGATE_API_KEY");
  });
});
