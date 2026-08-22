import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_ROLES } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { CURRICULUM, contentDirFor } from "@/lib/curriculum";

const CONTENT_DIR = join(process.cwd(), "src/content");
const ZONES_DIR = join(process.cwd(), "../../packages/dns-fixtures/zones");

const LOOKUP = /<Lookup\b[\s\S]*?\n\/>/g;
const NAME = /name="([^"]+)"/;
const ORIGIN = /^\$ORIGIN\s+(\S+)/gm;
const TRAILING_DOT = /\.$/;
const SERVER = /server="([^"]+)"/;

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
