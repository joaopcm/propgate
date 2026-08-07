import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coverageByRfc } from "@propgate/dns";
import { extractMdx } from "./mdx-text";
import { type FlatNavEntry, flattenNavigation } from "./navigation";
import type { SearchRecord } from "./search";
import { slugify } from "./slug";
import { allEntries, families } from "./taxonomy";
import { EVENT_NAMES, EVENTS } from "./webhooks";

/**
 * The whole site as one flat list of searchable sections, built once.
 *
 * Build time only — `output: "export"` means there is no server to build it at
 * request time, and no server is wanted: the result is written to
 * `out/search-index.json` by the route handler and fetched by the browser the
 * first time somebody focuses the box.
 *
 * Two sources, because the site has two kinds of page. The 31 MDX pages are read
 * off disk and split at their headings. The four `.tsx` pages have no markdown
 * anywhere — their text is JSX over a typed registry — so they are rebuilt from
 * the same registries the pages render, which is also what stops the index
 * drifting from them. The 74 `/taxonomy/<slug>` pages are the reason that second
 * path is worth having: they are not in the sidebar at all, and pasting a
 * diagnosis code into the box is the query this feature exists to answer.
 *
 * Iterating `flattenNavigation()` rather than globbing is deliberate:
 * `navigation.spec.ts` already asserts every href resolves to a page on disk, so
 * reusing it means the index and the sidebar cannot disagree about what exists.
 */

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

/**
 * One record per diagnosis code, titled with the code itself.
 *
 * The fixture *names* go in, and their reasons deliberately do not. A reason is
 * written per zone rather than per code, so `spf.test`'s paragraph is attached
 * to fifteen codes at once: indexing it would let a search for a word in that
 * paragraph return all fifteen with identical scores, tie-broken alphabetically,
 * which reads as the search having no opinion. The reason is on the page for
 * somebody who has arrived. It is not what should get them there.
 */
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

/**
 * The four events all anchor at `#events`, which is the only id that section
 * has. `search.ts` collapses them to the best match rather than spending four
 * of eight result slots on the same link.
 */
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

/** Every record, in navigation order — which `search.ts` uses to break ties. */
export function buildSearchIndex(): SearchRecord[] {
  return flattenNavigation().flatMap((entry) => {
    const generate = GENERATED[entry.href];

    return generate === undefined ? mdxRecords(entry) : generate(entry);
  });
}
