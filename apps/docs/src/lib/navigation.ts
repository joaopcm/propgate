export interface NavItem {
  readonly badge?: "beta" | "new";
  readonly href: string;
  readonly title: string;
}

export interface NavGroup {
  readonly items: readonly NavItem[];
  readonly title: string;
}

/**
 * A section is flat or grouped, never both.
 *
 * "Get started" is four pages and wants no subheadings; the API reference is
 * twenty and is unreadable without them. Modelling that as a union rather than
 * an always-present optional `groups` means the sidebar cannot render a section
 * two ways depending on data, and a section cannot half-declare a hierarchy.
 */
export type NavSection =
  | { readonly groups: readonly NavGroup[]; readonly title: string }
  | { readonly items: readonly NavItem[]; readonly title: string };

export function isGroupedSection(
  section: NavSection
): section is { readonly groups: readonly NavGroup[]; readonly title: string } {
  return "groups" in section;
}

export interface FlatNavEntry {
  readonly group?: string;
  readonly href: string;
  readonly section: string;
  readonly title: string;
}

/**
 * Every section in reading order, some still empty.
 *
 * The sections are declared up front and filled by later tasks, so the sidebar
 * grows downward in place rather than reordering itself under a reader between
 * commits. An empty section renders nothing.
 *
 * Only pages that exist are listed. `navigation.spec.ts` walks this array against
 * the filesystem, which is what makes a link to an unwritten page a failing test
 * rather than a 404 nobody notices — and why this plan has no placeholder pages.
 */
export const navigation: readonly NavSection[] = [
  {
    items: [{ href: "/", title: "Introduction" }],
    title: "Get started",
  },
  { items: [], title: "Concepts" },
  {
    groups: [
      { items: [{ href: "/api", title: "Overview" }], title: "Get started" },
    ],
    title: "API reference",
  },
  { items: [], title: "CLI" },
  { items: [], title: "@propgate/dns" },
  {
    items: [
      { href: "/taxonomy", title: "Diagnosis taxonomy" },
      { href: "/webhooks", title: "Webhook payloads" },
      { href: "/conformance", title: "RFC conformance" },
    ],
    title: "Reference",
  },
];

export function flattenNavigation(): FlatNavEntry[] {
  return navigation.flatMap((section) => {
    if (isGroupedSection(section)) {
      return section.groups.flatMap((group) =>
        group.items.map((item) => ({
          group: group.title,
          href: item.href,
          section: section.title,
          title: item.title,
        }))
      );
    }

    return section.items.map((item) => ({
      href: item.href,
      section: section.title,
      title: item.title,
    }));
  });
}

export function findNavEntry(href: string): FlatNavEntry | undefined {
  return flattenNavigation().find((entry) => entry.href === href);
}
