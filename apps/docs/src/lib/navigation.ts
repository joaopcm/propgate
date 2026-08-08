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

/**
 * Whether a section has anything to show.
 *
 * A flat section is non-empty when it has items; a grouped section is
 * non-empty when at least one of its groups does — a section can legally
 * hold only empty groups while later tasks fill them in. The sidebar filters
 * on this so a section with nothing to show renders no heading at all,
 * rather than an empty one.
 */
export function sectionHasItems(section: NavSection): boolean {
  return isGroupedSection(section)
    ? section.groups.some((group) => group.items.length > 0)
    : section.items.length > 0;
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
    items: [
      { href: "/", title: "Introduction" },
      { href: "/quickstart", title: "Quickstart" },
      { href: "/authentication", title: "Authentication" },
    ],
    title: "Get started",
  },
  {
    items: [
      { href: "/concepts/profiles", title: "Profiles and versions" },
      { href: "/concepts/verdicts", title: "Verdicts and state" },
      { href: "/concepts/monitoring", title: "Monitoring and hysteresis" },
      { href: "/concepts/diagnosis", title: "Diagnosis codes" },
    ],
    title: "Concepts",
  },
  {
    groups: [
      {
        items: [
          { href: "/api", title: "Overview" },
          { href: "/api/checks", title: "Check a domain" },
        ],
        title: "Get started",
      },
      {
        items: [
          { href: "/api/accounts/signup", title: "Sign up" },
          { href: "/api/accounts/confirm", title: "Confirm" },
        ],
        title: "Accounts",
      },
      {
        items: [
          { href: "/api/api-keys/create", title: "Create key" },
          { href: "/api/api-keys/list", title: "List keys" },
          { href: "/api/api-keys/revoke", title: "Revoke key" },
        ],
        title: "API keys",
      },
      {
        items: [{ href: "/api/members/list", title: "List members" }],
        title: "Members",
      },
      {
        items: [
          { href: "/api/profiles/create", title: "Create profile" },
          { href: "/api/profiles/get", title: "Get profile" },
        ],
        title: "Profiles",
      },
      {
        items: [
          { href: "/api/domains/register", title: "Register domain" },
          { href: "/api/domains/update", title: "Update domain" },
          { href: "/api/domains/verify", title: "Verify domain" },
          { href: "/api/domains/list", title: "List domains" },
          { href: "/api/domains/get", title: "Get domain" },
          { href: "/api/domains/timeline", title: "Timeline" },
          { href: "/api/domains/delete", title: "Delete domain" },
        ],
        title: "Domains",
      },
      {
        items: [
          { href: "/api/webhooks/create", title: "Create endpoint" },
          { href: "/api/webhooks/list", title: "List endpoints" },
          { href: "/api/webhooks/get", title: "Get endpoint" },
          { href: "/api/webhooks/update", title: "Update endpoint" },
          { href: "/api/webhooks/delete", title: "Delete endpoint" },
          { href: "/api/webhooks/rotate-secret", title: "Rotate secret" },
          { href: "/api/webhooks/deliveries", title: "Deliveries" },
        ],
        title: "Webhooks",
      },
    ],
    title: "API reference",
  },
  {
    items: [
      { href: "/cli", title: "Overview" },
      { href: "/cli/check", title: "check" },
      { href: "/cli/accounts", title: "signup, confirm, keys" },
      { href: "/cli/profiles", title: "profiles" },
      { href: "/cli/domains", title: "domains" },
      { href: "/cli/webhooks", title: "webhooks" },
    ],
    title: "CLI",
  },
  {
    items: [
      { href: "/sdk", title: "Overview" },
      { href: "/sdk/errors", title: "Errors and retries" },
      { href: "/sdk/profiles", title: "profiles" },
      { href: "/sdk/domains", title: "domains" },
      { href: "/sdk/webhooks", title: "webhooks" },
      { href: "/sdk/accounts", title: "keys and members" },
    ],
    title: "SDK",
  },
  {
    items: [
      { href: "/dns", title: "Overview" },
      { href: "/dns/resolver", title: "The resolver" },
      { href: "/dns/evaluators", title: "The evaluators" },
      { href: "/dns/recipes", title: "Recipes" },
    ],
    title: "@propgate/dns",
  },
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
