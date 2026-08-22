import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coverageByRfc } from "@propgate/dns";
import { extractMdx } from "./mdx-text";
import { type FlatNavEntry, flattenNavigation } from "./navigation";
import type { SearchRecord } from "./search";
import { slugify } from "./slug";
import { allEntries, families } from "./taxonomy";
import { EVENT_NAMES, EVENTS } from "./webhooks";

const PAGES_DIR = join(process.cwd(), "src/app/(docs)");

function mdxPathFor(href: string): string {
  return join(PAGES_DIR, href === "/" ? "" : href, "page.mdx");
}

function mdxRecords(entry: FlatNavEntry): SearchRecord[] {
  const path = mdxPathFor(entry.href);

  if (!existsSync(path)) {
    return [];
  }

  const page = extractMdx(readFileSync(path, "utf8"));
  const title = page.title ?? entry.title;

  return page.sections.map((section) => ({
    group: entry.group,
    hash:
      section.heading === undefined
        ? undefined
        : `#${slugify(section.heading)}`,
    heading: section.heading,
    href: entry.href,
    section: entry.section,
    text: section.text,
    title,
  }));
}

function taxonomyCodeRecords(entry: FlatNavEntry): SearchRecord[] {
  return allEntries().map(({ definition, fixtures, unreproducible }) => ({
    group: entry.group,
    href: `/taxonomy/${definition.slug}`,
    section: entry.section,
    text: [
      definition.summary,
      `Severity: ${definition.severity}.`,
      fixtures.length === 0
        ? undefined
        : `Proven by ${fixtures.map((fixture) => fixture.zone).join(", ")}.`,
      unreproducible,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" "),
    title: definition.code,
  }));
}

function taxonomyRecords(entry: FlatNavEntry): SearchRecord[] {
  const index = families().map((family) => ({
    group: entry.group,
    hash: `#${family.id}`,
    heading: family.title,
    href: entry.href,
    section: entry.section,
    text: family.blurb,
    title: entry.title,
  }));

  return [...index, ...taxonomyCodeRecords(entry)];
}

function webhookRecords(entry: FlatNavEntry): SearchRecord[] {
  return EVENT_NAMES.map((event) => ({
    group: entry.group,
    hash: "#events",
    heading: "Events",
    href: entry.href,
    section: entry.section,
    text: `${EVENTS[event].summary} Fires ${EVENTS[event].fires}.`,
    title: event,
  }));
}

function conformanceRecords(entry: FlatNavEntry): SearchRecord[] {
  return coverageByRfc().map((rfc) => ({
    group: entry.group,
    hash: `#rfc-${rfc.rfc}`,
    heading: `RFC ${rfc.rfc}`,
    href: entry.href,
    section: entry.section,
    text: [
      rfc.title,
      `${rfc.implemented} of ${rfc.applicable} catalogued requirements implemented.`,
      ...rfc.gaps.map((gap) => gap.requirement),
    ].join(" "),
    title: entry.title,
  }));
}

const GENERATED: Record<string, (entry: FlatNavEntry) => SearchRecord[]> = {
  "/conformance": conformanceRecords,
  "/taxonomy": taxonomyRecords,
  "/webhooks": webhookRecords,
};

export function buildSearchIndex(): SearchRecord[] {
  return flattenNavigation().flatMap((entry) => {
    const generate = GENERATED[entry.href];

    return generate === undefined ? mdxRecords(entry) : generate(entry);
  });
}
