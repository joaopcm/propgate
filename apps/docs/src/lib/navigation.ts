export interface NavItem {
  readonly badge?: "beta" | "new";
  readonly href: string;
  readonly title: string;
}

export interface NavGroup {
  readonly items: readonly NavItem[];
  readonly title: string;
}

export type NavSection =
  | { readonly groups: readonly NavGroup[]; readonly title: string }
  | { readonly items: readonly NavItem[]; readonly title: string };

export function isGroupedSection(
  section: NavSection
): section is { readonly groups: readonly NavGroup[]; readonly title: string } {
  return "groups" in section;
}

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

export const navigation: readonly NavSection[] = [
  {
    items: [
      { href: "/", title: "Introduction" },
      { href: "/quickstart", title: "Quickstart" },
      { href: "/authentication", title: "Authentication" },
      { href: "/developers", title: "Developer portal" },
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
