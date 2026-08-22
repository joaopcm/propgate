import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRICULUM, contentDirFor, unitBySlug, unitIndex } from "./curriculum";

const CONTENT_DIR = join(process.cwd(), "src/content");

function unitPath(index: number): string {
  const unit = CURRICULUM[index];

  if (unit === undefined) {
    throw new Error(`no unit at index ${index}`);
  }

  return join(CONTENT_DIR, contentDirFor(index, unit.slug));
}

describe("the curriculum", () => {
  it("has unique slugs", () => {
    const slugs = CURRICULUM.map((unit) => unit.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has unique titles", () => {
    const titles = CURRICULUM.map((unit) => unit.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("finds a unit by its slug", () => {
    const [first] = CURRICULUM;

    expect(first).toBeDefined();
    expect(unitBySlug(first?.slug ?? "")).toBe(first);
    expect(unitBySlug("no-such-unit")).toBeUndefined();
  });

  it("reports -1 for a slug it does not have", () => {
    expect(unitIndex("no-such-unit")).toBe(-1);
  });

  it("gives every unit a blurb and an assumption", () => {
    for (const unit of CURRICULUM) {
      expect(unit.blurb.length).toBeGreaterThan(0);
      expect(unit.assumes.length).toBeGreaterThan(0);
    }
  });

  it("gives every unit at least two sections", () => {
    for (const unit of CURRICULUM) {
      expect(unit.sections.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the curriculum against the filesystem", () => {
  it("has a unit.mdx and a quiz.ts for every unit", () => {
    for (const [index, unit] of CURRICULUM.entries()) {
      const dir = unitPath(index);

      expect(existsSync(join(dir, "unit.mdx")), `${unit.slug}/unit.mdx`).toBe(
        true
      );
      expect(existsSync(join(dir, "quiz.ts")), `${unit.slug}/quiz.ts`).toBe(
        true
      );
    }
  });

  it("has no content directory the curriculum does not list", () => {
    const listed = new Set(
      CURRICULUM.map((unit, index) => contentDirFor(index, unit.slug))
    );
    const onDisk = readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const dir of onDisk) {
      expect(listed.has(dir), `${dir} is on disk but not in CURRICULUM`).toBe(
        true
      );
    }
  });

  it("declares only sections that exist as headings in the prose", () => {
    for (const [index, unit] of CURRICULUM.entries()) {
      const mdx = readFileSync(join(unitPath(index), "unit.mdx"), "utf8");

      for (const section of unit.sections) {
        expect(mdx, `${unit.slug}: ${section}`).toContain(`## ${section}`);
      }
    }
  });

  it("is mentioned in full by the MDX content map", () => {
    const map = readFileSync(join(CONTENT_DIR, "units.ts"), "utf8");

    for (const [index, unit] of CURRICULUM.entries()) {
      expect(map, `${unit.slug} import`).toContain(
        contentDirFor(index, unit.slug)
      );
      expect(map, `${unit.slug} key`).toContain(`"${unit.slug}":`);
    }
  });

  it("declares every heading in the prose as a section", () => {
    for (const [index, unit] of CURRICULUM.entries()) {
      const mdx = readFileSync(join(unitPath(index), "unit.mdx"), "utf8");
      const headings = [...mdx.matchAll(/^## (.+)$/gm)].map((match) =>
        (match[1] ?? "").trim()
      );

      expect(headings, unit.slug).toEqual([...unit.sections]);
    }
  });
});
