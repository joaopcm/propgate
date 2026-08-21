import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_ROLES } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { CURRICULUM, contentDirFor } from "@/lib/curriculum";

/**
 * Every exercise, against the zones the fixture tier actually serves.
 *
 * The course claims each query goes to a real authoritative server rather than
 * to a simulation. That claim is only worth making if it is checked, and it
 * cannot be checked the obvious way here: running the queries needs
 * `pnpm dns:up`, and `TESTING.md` keeps container-dependent specs behind
 * `PROPGATE_FIXTURES` for exactly that reason. This spec runs everywhere and
 * asserts the next best thing — that every name an exercise prints falls inside
 * a zone that exists on disk.
 *
 * **Zone granularity, not label granularity, and deliberately.** Several
 * exercises query a name that is *meant* to be NXDOMAIN — the correct DKIM name
 * in `appended.test`, a missing record in `negcache-low.test` — so asserting
 * that every owner name exists would fail on the fixtures whose whole point is
 * that it does not. What a typo actually produces is a query into a zone nobody
 * serves, which times out rather than answering, and that is what this catches.
 *
 * The `server` attribute needs no assertion: it is typed as `FixtureRole`, so
 * `tsc` already rejects a role that does not exist. The count below is only
 * here to notice if that type ever widens.
 */

const CONTENT_DIR = join(process.cwd(), "src/content");
const ZONES_DIR = join(process.cwd(), "../../packages/dns-fixtures/zones");

/**
 * Terminates on `/>` at the start of a line, not on the first `/>` anywhere.
 *
 * A fragment closing tag — `</>` — contains the two characters `/>`, and every
 * `notice` prop is wrapped in one. A lazy `[\s\S]*?\/>` therefore stops inside
 * the notice and never reaches the `server` attribute below it, which reads as
 * "no exercises found" rather than as a broken pattern.
 */
const LOOKUP = /<Lookup\b[\s\S]*?\n\/>/g;
const NAME = /name="([^"]+)"/;
const ORIGIN = /^\$ORIGIN\s+(\S+)/gm;
const TRAILING_DOT = /\.$/;
const SERVER = /server="([^"]+)"/;

/** Every `$ORIGIN` the fixture zone files declare, without the trailing dot. */
function fixtureZones(): ReadonlySet<string> {
  const zones = new Set<string>();

  for (const dir of readdirSync(ZONES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) {
      continue;
    }

    for (const file of readdirSync(join(ZONES_DIR, dir.name))) {
      if (!file.endsWith(".zone")) {
        continue;
      }

      const text = readFileSync(join(ZONES_DIR, dir.name, file), "utf8");

      for (const match of text.matchAll(ORIGIN)) {
        const origin = (match[1] ?? "").replace(TRAILING_DOT, "");

        if (origin.length > 0) {
          zones.add(origin);
        }
      }
    }
  }

  return zones;
}

interface Exercise {
  readonly name: string;
  readonly server: string;
  readonly unit: string;
}

function exercises(): Exercise[] {
  const found: Exercise[] = [];

  for (const [index, unit] of CURRICULUM.entries()) {
    const mdx = readFileSync(
      join(CONTENT_DIR, contentDirFor(index, unit.slug), "unit.mdx"),
      "utf8"
    );

    for (const block of mdx.match(LOOKUP) ?? []) {
      const name = NAME.exec(block);
      const server = SERVER.exec(block);

      if (name?.[1] !== undefined && server?.[1] !== undefined) {
        found.push({ name: name[1], server: server[1], unit: unit.slug });
      }
    }
  }

  return found;
}

describe("the exercises", () => {
  const zones = fixtureZones();
  const all = exercises();

  it("exist at all", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it("appear only in units that declare they need the fixture tier", () => {
    const withExercises = new Set(all.map((entry) => entry.unit));

    for (const unit of CURRICULUM) {
      if (withExercises.has(unit.slug)) {
        expect(unit.needsFixtures, `${unit.slug} has exercises`).toBe(true);
      }
    }
  });

  it("each ask a server the manifest knows about", () => {
    const roles: readonly string[] = FIXTURE_ROLES;

    for (const entry of all) {
      expect(roles, `${entry.unit}: ${entry.name}`).toContain(entry.server);
    }
  });

  /**
   * The assertion this file exists for. A name whose zone nobody serves does
   * not error for the reader — it times out, which reads as "the fixtures are
   * broken" rather than "the course has a typo".
   */
  it("each name a zone the fixture tier serves", () => {
    for (const entry of all) {
      const labels = entry.name.split(".");
      const served = labels.some((_, index) =>
        zones.has(labels.slice(index).join("."))
      );

      expect(served, `${entry.unit}: ${entry.name} is in no fixture zone`).toBe(
        true
      );
    }
  });
});
