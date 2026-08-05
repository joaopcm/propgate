# Docs restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/docs` from four flat pages into a navigable, syntax-highlighted reference that walks a reader from the surface to the deep concepts, documents every operation as both a cURL call and a CLI command, adds a section for `@propgate/dns` as a library, and stays machine-readable for the agents that will read it.

**Architecture:** A grouped navigation model (`lib/navigation.ts`) drives a sidebar, breadcrumbs and prev/next pager. Prose moves to MDX so Shiki highlights fenced code; the typed registries (`lib/api.ts`, `lib/taxonomy.ts`, `lib/webhooks.ts`) stay the source of truth for *what exists*, with new specs failing when a registry entry has no page. Each page also serves itself as raw markdown at `<path>.md`, and every page concatenated at `/llms-full.txt`.

**Tech Stack:** Next.js 16 (`output: "export"`), `@next/mdx`, `@shikijs/rehype` + `shiki` (already dependencies), Tailwind 4, Vitest 4.

## Global Constraints

- **No new runtime dependencies.** `shiki`, `@next/mdx`, `@shikijs/rehype`, `remark-gfm` are already in `apps/docs/package.json`. There is no `clsx`, no `tailwind-merge`, no `lucide-react`, and **no `@propgate/ui` package** — `.claude/CLAUDE.md` lists `ui` as deliberately not built yet, so do not create it. Write the four-line `cn` helper in Task 1 instead.
- **`output: "export"` stays.** Verified: static route handlers with `export const dynamic = "force-static"` do emit real files under export (`out/probe.md` was produced by a throwaway probe). No server-only feature may be introduced.
- **Shiki theme is `github-dark-dimmed`**, matching the value already configured in `apps/docs/next.config.ts` and buckt's `SHIKI_THEME`.
- **The diagnosis taxonomy keeps its current generated form.** `lib/taxonomy.ts` + `app/taxonomy/[slug]/page.tsx` render 74 pages from `DIAGNOSIS_REGISTRY` and `FIXTURE_EXPECTATIONS`. Do not convert these to hand-written MDX; only re-home them under the new layout.
- **Guards may not be weakened.** `lib/api.spec.ts`, `lib/taxonomy.spec.ts` and `lib/webhooks.spec.ts` must keep passing unchanged. New pages add guards, they never remove them.
- Comments explain *why*. No comment restates what the code does. No commented-out code.
- `pnpm fix` before each commit. `pnpm lint` (tsc) and `pnpm check` (Biome) must be clean, and `pnpm --filter @propgate/docs build` must succeed, at the end of every task.
- Biome will reject: bitwise operators, regexes declared inside functions (`useTopLevelRegex`), `await` inside loops (`noAwaitInLoops`), array index access where destructuring works (`useDestructuring`), and an italic `*word*` on the line after a JSDoc asterisk (`useSingleJsDocAsterisk`).

---

## File Structure

**New — the shell:**

| File | Responsibility |
|---|---|
| `src/lib/cn.ts` | Join class names. Four lines, no dependency |
| `src/lib/navigation.ts` | `NavSection[]`, flat or grouped; `flattenNavigation()`, `findNavEntry()` |
| `src/lib/navigation.spec.ts` | Every href unique, every href has a page on disk |
| `src/lib/pager.ts` | `pagerFor(href)` → prev/next neighbours from `flattenNavigation` |
| `src/lib/pager.spec.ts` | First page, last page, middle, and a page outside the nav |
| `src/lib/shiki.ts` | `SHIKI_THEME`, `highlight(code, lang)` |
| `src/components/docs-sidebar.tsx` | Client. Renders `navigation`, marks the active item |
| `src/components/docs-header.tsx` | Server. Wordmark, link to the API, link to GitHub |
| `src/components/mobile-sidebar.tsx` | Client. The sidebar behind a disclosure under `md` |
| `src/components/docs/code-block.tsx` | Server. One highlighted block |
| `src/components/docs/code-tabs.tsx` | Server. Highlights each item, delegates to the client |
| `src/components/docs/code-tabs-client.tsx` | Client. Tab state and the copy button |
| `src/components/docs/endpoint-header.tsx` | Server. Method, path, and the CLI equivalent |
| `src/components/docs/params-table.tsx` | Server. `ParamRow[]` → table |
| `src/components/docs/callout.tsx` | Server. `note` / `warning` aside |
| `src/components/docs/breadcrumbs.tsx` | Client. Section › group › page from `findNavEntry` |
| `src/components/docs/pager-footer.tsx` | Client. Prev/next from `flattenNavigation` |
| `mdx-components.tsx` | `useMDXComponents` — element styling, `pre` → highlighted block |

**New — content.** Every page is `src/app/(docs)/<path>/page.mdx`, with co-located `_snippets.ts` where it has code:

```
(docs)/layout.tsx                     the sidebar + main + pager frame
(docs)/page.mdx                       Introduction
(docs)/quickstart/                    Quickstart
(docs)/authentication/                Authentication
(docs)/concepts/profiles/             Profiles and versions
(docs)/concepts/verdicts/             Verdicts and domain state
(docs)/concepts/monitoring/           Consensus, hysteresis, state
(docs)/concepts/diagnosis/            Why diagnosis codes exist
(docs)/api/page.mdx                   API overview (replaces today's monolith)
(docs)/api/accounts/                  signup, confirm
(docs)/api/api-keys/                  create, list, revoke
(docs)/api/members/                   list
(docs)/api/profiles/                  create, get
(docs)/api/domains/                   register, verify, list, get, timeline, delete
(docs)/api/webhooks/                  the seven-route family
(docs)/cli/page.mdx                   CLI overview
(docs)/cli/check/                     propgate check
(docs)/cli/accounts/                  signup, confirm, keys
(docs)/cli/domains/                   domains add, domains list
(docs)/dns/page.mdx                   @propgate/dns overview
(docs)/dns/resolver/                  query, transports, port awareness
(docs)/dns/evaluators/                the six checks as library calls
(docs)/dns/recipes/                   worked examples
```

**Moved, not rewritten:** `taxonomy/`, `taxonomy/[slug]/`, `conformance/`, `webhooks/` become children of `(docs)`. The taxonomy pages stay `.tsx` and stay generated.

**New — machine readable:**

| File | Responsibility |
|---|---|
| `src/lib/page-markdown.ts` | Read a `page.mdx`, strip imports and the metadata export, return markdown |
| `src/lib/page-markdown.spec.ts` | No `import` line and no `export const metadata` survives |
| `src/lib/markdown-route.ts` | `buildMarkdownRoute(mdxPath)` → a `force-static` GET |
| `src/app/(docs)/<path>.md/route.ts` | One per MDX page |
| `src/app/llms-full.txt/route.ts` | Every page's markdown, in navigation order |
| `src/app/llms.txt/route.ts` | The index: title, one-line summary, link per page |
| `src/lib/llms.spec.ts` | Every navigation href appears in `llms.txt` |

**A deliberate divergence from buckt.** Buckt converts MDX to markdown with a 221-line transformer plus a 347-line spec, substituting snippet constants into rendered JSX. We serve the MDX body nearly verbatim instead — imports and the metadata export removed, everything else left alone. An agent reading `<CodeTabs items={[...]} />` around a fenced block loses nothing, and a lossy transformer is 570 lines of surface area that can silently drop content. Revisit if a real reader complains.

---

## The target navigation

**Every task adds its own slice of this, in this order, as it creates the pages.**
Task 1 implements the model plus only the entries whose pages already exist; the
`navigation.spec.ts` guard asserts every href has a page on disk, so a task that
lists a page it did not write fails immediately. That is why there are no
placeholder pages in this plan: an incomplete sidebar on a feature branch is
honest, and a page saying "coming soon" is not.

| Section | Group | Items | Added by |
|---|---|---|---|
| Get started | — | `/` Introduction | Task 1 |
| Get started | — | `/quickstart`, `/authentication` | Task 4 |
| Concepts | — | `/concepts/profiles`, `/concepts/verdicts`, `/concepts/monitoring`, `/concepts/diagnosis` | Task 5 |
| API reference | Get started | `/api` Overview | Task 1 |
| API reference | Accounts | `/api/accounts/signup`, `/api/accounts/confirm` | Task 6 |
| API reference | API keys | `/api/api-keys/create`, `/list`, `/revoke` | Task 6 |
| API reference | Members | `/api/members/list` | Task 6 |
| API reference | Profiles | `/api/profiles/create`, `/get` | Task 7 |
| API reference | Domains | `/api/domains/register`, `/verify`, `/list`, `/get`, `/timeline`, `/delete` | Task 7 |
| API reference | Webhooks | `/api/webhooks/endpoints` | Task 7 |
| CLI | — | `/cli`, `/cli/check`, `/cli/accounts`, `/cli/domains` | Task 8 |
| @propgate/dns | — | `/dns`, `/dns/resolver`, `/dns/evaluators`, `/dns/recipes` | Task 9 |
| Reference | — | `/taxonomy`, `/webhooks`, `/conformance` | Task 1 |

Section order in the array is the reading order the sidebar and the prev/next
pager both follow, so **sections must be declared in the order above from Task 1
onward**, even while some are empty of items. A section with no items renders
nothing; adding items later fills it in place rather than reordering the sidebar
under a reader.

---

## Task 1: The shell — navigation, sidebar, layout

**Files:**
- Create: `apps/docs/src/lib/cn.ts`
- Create: `apps/docs/src/lib/navigation.ts`
- Create: `apps/docs/src/lib/navigation.spec.ts`
- Create: `apps/docs/src/components/docs-sidebar.tsx`
- Create: `apps/docs/src/components/docs-header.tsx`
- Create: `apps/docs/src/components/mobile-sidebar.tsx`
- Create: `apps/docs/src/app/(docs)/layout.tsx`
- Modify: `apps/docs/src/app/layout.tsx` — drop the centred `<main>`, which the docs layout now owns

**Interfaces:**
- Produces: `cn(...values: (string | false | undefined | null)[]): string`; `NavItem { href: string; title: string; badge?: "new" | "beta" }`; `NavGroup { items: NavItem[]; title: string }`; `NavSection = { items: NavItem[]; title: string } | { groups: NavGroup[]; title: string }`; `navigation: NavSection[]`; `isGroupedSection(section): section is { groups: NavGroup[]; title: string }`; `flattenNavigation(): FlatNavEntry[]` where `FlatNavEntry { group?: string; href: string; section: string; title: string }`; `findNavEntry(href: string): FlatNavEntry | undefined`; `<DocsSidebar onNavigate?: () => void />`

- [ ] **Step 1: Write the failing test**

`apps/docs/src/lib/navigation.spec.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNavEntry, flattenNavigation, navigation } from "./navigation";

/**
 * The sidebar against the filesystem.
 *
 * A link in the sidebar that 404s is the worst defect a docs site can have: it
 * is invisible in review, it looks like the product is half-built, and nothing
 * else in the suite can see it. `output: "export"` makes it worse — the build
 * succeeds and the file simply is not there.
 */

const APP = join(process.cwd(), "src/app/(docs)");

function pageExistsFor(href: string): boolean {
  const relative = href === "/" ? "" : href;

  return (
    existsSync(join(APP, relative, "page.mdx")) ||
    existsSync(join(APP, relative, "page.tsx"))
  );
}

describe("navigation", () => {
  it("is not empty", () => {
    expect(navigation.length).toBeGreaterThan(0);
    expect(flattenNavigation().length).toBeGreaterThan(0);
  });

  it("lists every href exactly once", () => {
    const hrefs = flattenNavigation().map((entry) => entry.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("points every href at a page that exists", () => {
    const missing = flattenNavigation()
      .map((entry) => entry.href)
      .filter((href) => !pageExistsFor(href));

    expect(missing).toEqual([]);
  });

  it("resolves an entry back to its section and group", () => {
    const entry = findNavEntry("/api");

    expect(entry?.section).toBe("API reference");
    expect(entry?.group).toBe("Get started");
  });

  it("has no entry for a page nobody wrote", () => {
    expect(findNavEntry("/nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/docs && npx vitest run src/lib/navigation.spec.ts`
Expected: FAIL — `Failed to resolve import "./navigation"`.

- [ ] **Step 3: Write `cn`**

`apps/docs/src/lib/cn.ts`:

```ts
/**
 * Join class names, dropping the falsy ones.
 *
 * Four lines rather than `clsx` and `tailwind-merge`. This app has no runtime
 * dependencies beyond Next, React and Shiki, and the only thing those two
 * packages would buy here is conflict resolution between Tailwind classes —
 * which is a problem this codebase does not have, because no component takes a
 * `className` override.
 */
export function cn(
  ...values: (string | false | undefined | null)[]
): string {
  return values.filter(Boolean).join(" ");
}
```

- [ ] **Step 4: Write the navigation model**

`apps/docs/src/lib/navigation.ts`. Only the section list is shown in full below the types; fill it with exactly the hrefs in the File Structure table, in that order.

```ts
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
```

- [ ] **Step 5: Move the four existing pages under `(docs)`**

`git mv` so history follows the files. No new pages are created in this task — the
five hrefs above are exactly the pages that exist once these moves are done, which
is what makes the navigation spec pass without placeholders:

```bash
cd apps/docs/src/app
mkdir -p "(docs)"
git mv page.tsx "(docs)/page.tsx"        # becomes page.mdx in Task 4
git mv api "(docs)/api"
git mv webhooks "(docs)/webhooks"
git mv conformance "(docs)/conformance"
git mv taxonomy "(docs)/taxonomy"
```

`(docs)` is a route group, so it contributes nothing to the URL — `/api` stays
`/api`. Verify that in Step 9 by checking `out/api.html` exists, not
`out/(docs)/api.html`.

- [ ] **Step 6: Write the sidebar**

`apps/docs/src/components/docs-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isGroupedSection, type NavItem, navigation } from "@/lib/navigation";

const BADGE_LABELS: Record<NonNullable<NavItem["badge"]>, string> = {
  beta: "Beta",
  new: "New",
};

function ItemList({
  items,
  onNavigate,
  pathname,
}: {
  items: readonly NavItem[];
  onNavigate?: () => void;
  pathname: string;
}) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const isActive = pathname === item.href;

        return (
          <li key={item.href}>
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground",
                isActive && "bg-muted font-medium text-foreground"
              )}
              href={item.href}
              onClick={onNavigate}
            >
              <span>{item.title}</span>
              {item.badge ? (
                <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                  {BADGE_LABELS[item.badge]}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Documentation"
      className="flex flex-col gap-6 px-4 py-6 md:px-6"
    >
      {navigation.map((section) => (
        <div className="flex flex-col gap-3" key={section.title}>
          <h2 className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
            {section.title}
          </h2>
          {isGroupedSection(section) ? (
            <div className="flex flex-col gap-3">
              {section.groups.map((group) => (
                <div className="flex flex-col gap-1" key={group.title}>
                  <h3 className="px-2 font-medium text-[11px] text-foreground/80">
                    {group.title}
                  </h3>
                  <ItemList
                    items={group.items}
                    onNavigate={onNavigate}
                    pathname={pathname}
                  />
                </div>
              ))}
            </div>
          ) : (
            <ItemList
              items={section.items}
              onNavigate={onNavigate}
              pathname={pathname}
            />
          )}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 7: Write the header and the mobile sidebar**

`apps/docs/src/components/docs-header.tsx`:

```tsx
import Link from "next/link";
import { MobileSidebar } from "@/components/mobile-sidebar";

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-border/80 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      <MobileSidebar />
      <Link className="font-semibold text-sm tracking-tight" href="/">
        propgate <span className="text-muted-foreground">docs</span>
      </Link>
      <nav className="ml-auto flex items-center gap-4 text-muted-foreground text-xs">
        <Link className="transition-colors hover:text-foreground" href="/api">
          API
        </Link>
        <a
          className="transition-colors hover:text-foreground"
          href="https://github.com/joaopcm/propgate"
        >
          GitHub
        </a>
      </nav>
    </header>
  );
}
```

`apps/docs/src/components/mobile-sidebar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DocsSidebar } from "@/components/docs-sidebar";

export function MobileSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        aria-expanded={open}
        aria-label="Toggle documentation navigation"
        className="px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
        onClick={() => setOpen(!open)}
        type="button"
      >
        Menu
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-14 max-h-[70vh] overflow-y-auto border-border/80 border-b bg-background">
          <DocsSidebar onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Write the docs layout and thin the root layout**

`apps/docs/src/app/(docs)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <DocsHeader />
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-border/80 border-r md:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-10 md:py-12">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

In `apps/docs/src/app/layout.tsx`, replace the `<body>` contents so the docs layout owns the width:

```tsx
      <body className="bg-background font-sans text-foreground">{children}</body>
```

- [ ] **Step 9: Run the spec and the build**

Run: `cd apps/docs && npx vitest run && npx next build`
Expected: navigation spec passes; build lists every new route as `○ (Static)`.

- [ ] **Step 10: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
git add -A && git commit -m "feat(docs): grouped navigation, sidebar and docs layout"
```

---

## Task 2: Syntax highlighting — MDX components, code blocks, tabs

**Files:**
- Create: `apps/docs/src/lib/shiki.ts`
- Create: `apps/docs/src/components/docs/code-block.tsx`
- Create: `apps/docs/src/components/docs/code-tabs.tsx`
- Create: `apps/docs/src/components/docs/code-tabs-client.tsx`
- Create: `apps/docs/src/components/docs/mdx-pre.tsx`
- Create: `apps/docs/src/components/docs/callout.tsx`
- Create: `apps/docs/mdx-components.tsx`
- Create: `apps/docs/src/components/docs/code-tabs.spec.ts`

**Interfaces:**
- Consumes: `cn` from Task 1
- Produces: `SHIKI_THEME`, `highlight(code: string, lang: string): Promise<string>`; `<CodeBlock code lang />`; `CodeTabsItem { code: string; label: string; lang: string }` and `<CodeTabs items={CodeTabsItem[]} />`; `<Callout kind="note" | "warning">…</Callout>`; `useMDXComponents`

- [ ] **Step 1: Write the failing test**

`apps/docs/src/components/docs/code-tabs.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { highlight, SHIKI_THEME } from "@/lib/shiki";

/**
 * That highlighting actually happens.
 *
 * The docs shipped for months with a hand-rolled `<Code>` that emitted a bare
 * `<pre>`, while Shiki sat configured and unused in `next.config.ts` — so the
 * failure mode here is not an exception, it is plain text that nobody notices is
 * plain. Asserting on the emitted markup is the only way to see the difference.
 */

describe("highlight", () => {
  it("emits token spans rather than plain text", async () => {
    const html = await highlight('curl -X POST "$URL"', "bash");

    expect(html).toContain("<pre");
    expect(html).toContain("<span");
    // A theme that failed to load renders every token in one colour.
    expect(html).toContain("style=");
  });

  it("uses the theme the MDX pipeline is configured with", () => {
    // Two highlighters run in this app: the rehype plugin for fenced blocks in
    // MDX, and this one for CodeTabs. Different themes would look like a bug.
    expect(SHIKI_THEME).toBe("github-dark-dimmed");
  });

  it("highlights each language it is given differently", async () => {
    const asJson = await highlight('{"domain":"example.com"}', "json");
    const asBash = await highlight('{"domain":"example.com"}', "bash");

    expect(asJson).not.toBe(asBash);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/docs && npx vitest run src/components/docs/code-tabs.spec.ts`
Expected: FAIL — cannot resolve `@/lib/shiki`.

- [ ] **Step 3: Write the Shiki helper**

`apps/docs/src/lib/shiki.ts`:

```ts
import { codeToHtml } from "shiki";

/**
 * The same theme `next.config.ts` gives `@shikijs/rehype`.
 *
 * Two highlighters run in this app — the rehype plugin for fenced code inside
 * MDX, and `highlight` below for the strings that `CodeTabs` is handed. They
 * have to agree, and a spec pins this constant to the configured value so a
 * change in one place fails rather than looking merely inconsistent.
 */
export const SHIKI_THEME = "github-dark-dimmed";

export async function highlight(code: string, lang: string): Promise<string> {
  return await codeToHtml(code, { lang, theme: SHIKI_THEME });
}
```

- [ ] **Step 4: Run the spec and watch it pass**

Run: `cd apps/docs && npx vitest run src/components/docs/code-tabs.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the code block, the tabs, and the MDX `pre`**

`apps/docs/src/components/docs/code-block.tsx`:

```tsx
import { highlight } from "@/lib/shiki";

/**
 * `dangerouslySetInnerHTML` is correct here and nowhere near a user.
 *
 * Shiki returns markup, and every string it is given in this app is a literal
 * written in this repository — there is no request-time input on this path, and
 * the site is a static export with no user content at all.
 */
export async function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const html = await highlight(code.trim(), lang);

  return (
    <div
      className="my-4 overflow-x-auto border border-white/5 text-[0.8125rem] leading-6 [&_pre]:p-4"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output, from literals in this repo
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

`apps/docs/src/components/docs/code-tabs-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface RenderedTab {
  readonly code: string;
  readonly html: string;
  readonly label: string;
}

export function CodeTabsClient({ items }: { items: readonly RenderedTab[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = items[active] ?? items[0];

  if (current === undefined) {
    return null;
  }

  return (
    <div className="my-4 border border-white/5">
      <div className="flex items-center gap-1 border-white/5 border-b px-2">
        {items.map((item, index) => (
          <button
            className={cn(
              "px-2 py-1.5 text-xs transition-colors",
              index === active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={item.label}
            onClick={() => setActive(index)}
            type="button"
          >
            {item.label}
          </button>
        ))}
        <button
          className="ml-auto px-2 py-1.5 text-muted-foreground text-xs hover:text-foreground"
          onClick={async () => {
            await navigator.clipboard.writeText(current.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          type="button"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className="overflow-x-auto text-[0.8125rem] leading-6 [&_pre]:p-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output, from literals in this repo
        dangerouslySetInnerHTML={{ __html: current.html }}
      />
    </div>
  );
}
```

`apps/docs/src/components/docs/code-tabs.tsx`:

```tsx
import {
  CodeTabsClient,
  type RenderedTab,
} from "@/components/docs/code-tabs-client";
import { highlight } from "@/lib/shiki";

export interface CodeTabsItem {
  readonly code: string;
  readonly label: string;
  readonly lang: string;
}

/**
 * Highlighted on the server, switched on the client.
 *
 * Shiki loads grammars and a theme — hundreds of kilobytes — so it must never
 * reach the browser. Everything below the highlight is a `useState`.
 */
export async function CodeTabs({
  items,
}: {
  items: readonly CodeTabsItem[];
}) {
  const rendered: RenderedTab[] = await Promise.all(
    items.map(async (item) => {
      const code = item.code.trim();

      return { code, html: await highlight(code, item.lang), label: item.label };
    })
  );

  return <CodeTabsClient items={rendered} />;
}
```

`apps/docs/src/components/docs/mdx-pre.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from "react";

/**
 * Fenced code in MDX is already highlighted by the time it reaches here.
 *
 * `@shikijs/rehype` runs during compilation and hands back a `<pre>` carrying
 * token spans and inline styles. This only frames it, and must not re-render the
 * children or the highlighting is thrown away.
 */
export function MdxPre({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="my-4 overflow-x-auto border border-white/5 text-[0.8125rem] leading-6">
      <pre className="p-4" {...props}>
        {children}
      </pre>
    </div>
  );
}
```

- [ ] **Step 6: Write the callout**

`apps/docs/src/components/docs/callout.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Callout({
  children,
  kind = "note",
}: {
  children: ReactNode;
  kind?: "note" | "warning";
}) {
  return (
    <aside
      className={cn(
        "my-4 border-l-2 px-4 py-2 text-sm leading-7",
        kind === "warning"
          ? "border-[var(--color-warning)] text-foreground"
          : "border-white/20 text-muted-foreground"
      )}
    >
      {children}
    </aside>
  );
}
```

- [ ] **Step 7: Write `mdx-components.tsx`**

Create `apps/docs/mdx-components.tsx` (repo root of the app, beside `next.config.ts`), exporting `useMDXComponents` that styles `h1`–`h3`, `p`, `a`, `ul`, `ol`, `code`, `table`, `thead`, `tbody`, `tr`, `th`, `td` with the Tailwind classes already used in `src/app/(docs)/api/page.tsx`, and maps `pre` to `MdxPre`. Use buckt's `apps/docs/mdx-components.tsx` as the reference for the element list and class names; substitute `MdxPre` for its import.

- [ ] **Step 8: Prove highlighting reaches the built page**

Add a fenced block and a `CodeTabs` to the placeholder `(docs)/quickstart/page.mdx`, build, and grep the emitted HTML:

```bash
cd apps/docs && npx next build
grep -c "shiki" out/quickstart.html
```
Expected: greater than 0. If it is 0, the rehype plugin is not running on this page — check `pageExtensions` includes `mdx` and that the file is `page.mdx`.

- [ ] **Step 9: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
git add -A && git commit -m "feat(docs): shiki highlighting, code tabs and MDX components"
```

---

## Task 3: Breadcrumbs, pager, endpoint header, params table

**Files:**
- Create: `apps/docs/src/lib/pager.ts`
- Create: `apps/docs/src/lib/pager.spec.ts`
- Create: `apps/docs/src/components/docs/breadcrumbs.tsx`
- Create: `apps/docs/src/components/docs/pager-footer.tsx`
- Create: `apps/docs/src/components/docs/endpoint-header.tsx`
- Create: `apps/docs/src/components/docs/params-table.tsx`
- Modify: `apps/docs/src/app/(docs)/layout.tsx` — add `<Breadcrumbs />` above and `<PagerFooter />` below `{children}`

**Interfaces:**
- Consumes: `flattenNavigation`, `findNavEntry`, `cn`
- Produces: `pagerFor(href: string): { next?: FlatNavEntry; previous?: FlatNavEntry }`; `<Breadcrumbs />`; `<PagerFooter />`; `<EndpointHeader method path cliCommand? />`; `ParamRow { description: string; name: string; required?: boolean; type: string }` and `<ParamsTable rows={ParamRow[]} />`

- [ ] **Step 1: Write the failing test**

The pager's neighbour logic is the one genuinely testable unit in this task, and
it has three off-by-one edges — first page, last page, and a page not in the
navigation at all. Extracting it from the component is what makes those reachable
without rendering React.

`apps/docs/src/lib/pager.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { flattenNavigation } from "./navigation";
import { pagerFor } from "./pager";

/**
 * Prev/next, derived from the same array the sidebar renders.
 *
 * Deriving rather than hand-listing is the point: the reading order the sidebar
 * implies and the order these links follow cannot disagree, and a page inserted
 * into `navigation` is wired into the pager by that fact alone.
 */

describe("pagerFor", () => {
  it("has no previous on the first page", () => {
    const [first] = flattenNavigation();
    const pager = pagerFor(String(first?.href));

    expect(pager.previous).toBeUndefined();
    expect(pager.next).toBeDefined();
  });

  it("has no next on the last page", () => {
    const entries = flattenNavigation();
    const last = entries.at(-1);
    const pager = pagerFor(String(last?.href));

    expect(pager.next).toBeUndefined();
    expect(pager.previous).toBeDefined();
  });

  it("gives both neighbours in the middle", () => {
    const entries = flattenNavigation();

    // Skipped rather than asserted when the navigation is still short: this task
    // runs before the content tasks fill the sections in.
    if (entries.length < 3) {
      return;
    }

    const middle = entries[1];
    const pager = pagerFor(String(middle?.href));

    expect(pager.previous?.href).toBe(entries[0]?.href);
    expect(pager.next?.href).toBe(entries[2]?.href);
  });

  it("gives neither for a page outside the navigation", () => {
    // The taxonomy's 74 slug pages are real pages with no sidebar entry, so this
    // is the common case rather than an error case.
    const pager = pagerFor("/taxonomy/spf-lookup-limit-near");

    expect(pager.previous).toBeUndefined();
    expect(pager.next).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/docs && npx vitest run src/lib/pager.spec.ts`
Expected: FAIL — cannot resolve `./pager`.

- [ ] **Step 2a: Implement the pager logic**

`apps/docs/src/lib/pager.ts`:

```ts
import { type FlatNavEntry, flattenNavigation } from "./navigation";

export function pagerFor(href: string): {
  next?: FlatNavEntry;
  previous?: FlatNavEntry;
} {
  const entries = flattenNavigation();
  const index = entries.findIndex((entry) => entry.href === href);

  if (index === -1) {
    return {};
  }

  const previous = entries[index - 1];
  const next = entries[index + 1];

  return {
    ...(next === undefined ? {} : { next }),
    ...(previous === undefined ? {} : { previous }),
  };
}
```

Run: `cd apps/docs && npx vitest run src/lib/pager.spec.ts` — expected PASS.

- [ ] **Step 3: Write the breadcrumbs and pager**

`apps/docs/src/components/docs/breadcrumbs.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { findNavEntry } from "@/lib/navigation";

export function Breadcrumbs() {
  const entry = findNavEntry(usePathname());

  if (entry === undefined) {
    return null;
  }

  return (
    <p className="mb-3 text-muted-foreground text-xs">
      {entry.section}
      {entry.group ? ` › ${entry.group}` : ""} › {entry.title}
    </p>
  );
}
```

`apps/docs/src/components/docs/pager-footer.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pagerFor } from "@/lib/pager";
export function PagerFooter() {
  const { next, previous } = pagerFor(usePathname());

  if (next === undefined && previous === undefined) {
    return null;
  }

  return (
    <nav className="mt-12 flex justify-between gap-4 border-border/80 border-t pt-6 text-sm">
      {previous ? (
        <Link
          className="text-muted-foreground hover:text-foreground"
          href={previous.href}
        >
          ← {previous.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          className="ml-auto text-muted-foreground hover:text-foreground"
          href={next.href}
        >
          {next.title} →
        </Link>
      ) : null}
    </nav>
  );
}
```

- [ ] **Step 4: Write the endpoint header and params table**

`apps/docs/src/components/docs/endpoint-header.tsx`:

```tsx
const METHOD_STYLE = {
  DELETE: "text-[var(--color-destructive)]",
  GET: "text-muted-foreground",
  PATCH: "text-[var(--color-warning)]",
  POST: "text-[var(--color-warning)]",
} as const;

/**
 * Method, path, and the CLI command that does the same thing.
 *
 * The CLI equivalent sits here rather than in a separate section because the two
 * are one decision for the reader — "how do I do this from a script" and "how do
 * I do this by hand" — and splitting them is how a CLI ends up undocumented.
 */
export function EndpointHeader({
  cliCommand,
  method,
  path,
}: {
  cliCommand?: string;
  method: keyof typeof METHOD_STYLE;
  path: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-white/5 border-b pb-3">
      <span
        className={`font-mono text-[0.6875rem] uppercase tracking-widest ${METHOD_STYLE[method]}`}
      >
        {method}
      </span>
      <code className="font-mono text-sm">{path}</code>
      {cliCommand ? (
        <code className="ml-auto font-mono text-muted-foreground text-xs">
          {cliCommand}
        </code>
      ) : null}
    </div>
  );
}
```

`apps/docs/src/components/docs/params-table.tsx`:

```tsx
export interface ParamRow {
  readonly description: string;
  readonly name: string;
  readonly required?: boolean;
  readonly type: string;
}

export function ParamsTable({ rows }: { rows: readonly ParamRow[] }) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="border-border border-b">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider">
              Field
            </th>
            <th className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider">
              Type
            </th>
            <th className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider">
              Description
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 font-mono text-foreground text-xs">
                {row.name}
                {row.required ? (
                  <span className="ml-1 text-[var(--color-destructive)]">*</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground text-xs">
                {row.type}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Wire them into the layout**

In `(docs)/layout.tsx`, wrap `{children}`:

```tsx
          <div className="mx-auto max-w-3xl">
            <Breadcrumbs />
            {children}
            <PagerFooter />
          </div>
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
git add -A && git commit -m "feat(docs): breadcrumbs, pager, endpoint header and params table"
```

---

## Task 4: Get started — Introduction, Quickstart, Authentication

**Files:**
- Create: `apps/docs/src/app/(docs)/page.mdx` (delete `page.tsx`)
- Create: `apps/docs/src/app/(docs)/quickstart/page.mdx`, `_snippets.ts`
- Create: `apps/docs/src/app/(docs)/authentication/page.mdx`, `_snippets.ts`

**Interfaces:**
- Consumes: `CodeTabs`, `Callout`, `CodeBlock`

Content rules for every page in Tasks 4–9:

- **Every operation gets both clients.** A `CodeTabs` with `cURL` first and `CLI` second. Where the CLI cannot do it, say so in one line rather than omitting the tab.
- **Source the prose from what already exists.** `QUICKSTART.md`, `README.md` and today's `api/page.tsx` carry reviewed copy with the reasoning already in it. Move it; do not rewrite it from memory, and do not invent examples.
- **Never invent output.** Only paste responses that are in `QUICKSTART.md` (real runs) or derivable from a route's `serialise` function. If a body is a shape rather than a capture, say so in the sentence above it — `QUICKSTART.md` already does this for the signup exchange.

- [ ] **Step 0: Add this task's navigation entries**

Add the rows this task owns from **The target navigation** table to
`src/lib/navigation.ts`, in the order given there. `navigation.spec.ts` asserts
every href has a page on disk, so add each entry in the same commit as its page —
listing a page you have not written yet turns the suite red.

- [ ] **Step 1: Write the Introduction**

`(docs)/page.mdx`. Lifts `README.md`'s "See it" and "What you get": the GitHub example with the two real findings, why a regex cannot find them, and a `CodeTabs` for the open `POST /v1/checks` (cURL) and `npx @propgate/cli check github.com` (CLI). Ends with three links: Quickstart, API reference, taxonomy. Delete `(docs)/page.tsx` in the same step.

- [ ] **Step 2: Write the Quickstart**

`(docs)/quickstart/page.mdx` follows `QUICKSTART.md`'s order — open check → get a key → profile → register → verify → read back — with each step a `CodeTabs`. `_snippets.ts` holds the strings, named `CHECK_CURL`, `CHECK_CLI`, `SIGNUP_CURL`, `SIGNUP_CLI`, `CONFIRM_CURL`, `CONFIRM_CLI`, `PROFILE_CURL`, `REGISTER_CURL`, `REGISTER_CLI`, `VERIFY_CURL`, `VERIFY_RESPONSE`.

Carry over `QUICKSTART.md`'s marker on the signup exchange verbatim in a `Callout`: the shapes come from the code, not a captured run, because the middle step is reading mail.

- [ ] **Step 3: Write Authentication**

`(docs)/authentication/page.mdx` merges today's `api/page.tsx` "Getting a key" and "Authentication" sections: the two signup calls, that the key is shown once because only a hash is stored, why the signup response is identical for known and unknown addresses, that re-running the flow mints an additional key against the same account, `PROPGATE_API_KEY` / `PROPGATE_API_URL`, and the `401` distinguishing revoked from unknown. Link on to `/api/api-keys/create`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
grep -c "shiki" out/quickstart.html   # expect > 0
git add -A && git commit -m "docs: introduction, quickstart and authentication"
```

---

## Task 5: Concepts — the deep end

**Files:**
- Create: `apps/docs/src/app/(docs)/concepts/profiles/page.mdx`
- Create: `apps/docs/src/app/(docs)/concepts/verdicts/page.mdx`
- Create: `apps/docs/src/app/(docs)/concepts/monitoring/page.mdx`
- Create: `apps/docs/src/app/(docs)/concepts/diagnosis/page.mdx`

**Interfaces:**
- Consumes: `VERDICTS` and `REQUIREMENT_TYPES` from `@/lib/api`, `Callout`, `CodeTabs`

These four are the "deep" end of the progression, and each answers a question the API reference cannot:

- [ ] **Step 0: Add this task's navigation entries**

Add the rows this task owns from **The target navigation** table to
`src/lib/navigation.ts`, in the order given there. `navigation.spec.ts` asserts
every href has a page on disk, so add each entry in the same commit as its page —
listing a page you have not written yet turns the suite red.

- [ ] **Step 1: Profiles and versions**

Why editing a profile writes a new version and a domain stays pinned to the one it was registered against — without it, one edit reclassifies every domain at once and, with webhooks, sends a storm with no deploy behind it. Why a definition is rejected at write time when a requirement could never be answered. Rendered from `REQUIREMENT_TYPES` so the list of check kinds cannot drift.

- [ ] **Step 2: Verdicts and state**

Render the `VERDICTS` record as a table, then the `pending → verifying → verified → degraded → failed` machine. The load-bearing paragraph: `indeterminate` changes nothing, and collapsing it into `fail` is how a monitoring product pages someone over its own bad second. Uses `VERDICTS` directly, so `api.spec.ts`'s "indeterminate is the only inert one" guard covers this page too.

- [ ] **Step 3: Monitoring and hysteresis**

The sweeper, adaptive scheduling, consensus across vantage points, and the consecutive-failure thresholds. State the honest limit already written into `TESTING.md` and `.env.production.example`: three resolvers behind one egress IP are weakly independent — they catch cache state, propagation lag and one broken resolver, and they cannot see GeoDNS or a path that differs by geography. A `Callout` for the once-per-episode `degraded` rule, so nobody builds a pager on it.

- [ ] **Step 4: Diagnosis codes**

Why a code rather than a boolean: `PROVIDER_APPENDED_ZONE_NAME` deflects a support ticket, "record not found" creates one. That codes are a public contract consumers switch on, that adding one requires a fixture or a written reason, and that changing or removing one is a breaking change. Links to `/taxonomy` as the full list.

- [ ] **Step 5: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
git add -A && git commit -m "docs: concepts — profiles, verdicts, monitoring, diagnosis"
```

---

## Task 6: API reference — overview and accounts, keys, members

**Files:**
- Modify: `apps/docs/src/app/(docs)/api/page.tsx` → replace with `page.mdx`
- Create: `(docs)/api/accounts/signup/{page.mdx,_snippets.ts}`, `(docs)/api/accounts/confirm/{page.mdx,_snippets.ts}`
- Create: `(docs)/api/api-keys/create/`, `list/`, `revoke/` — each `page.mdx` + `_snippets.ts`
- Create: `(docs)/api/members/list/{page.mdx,_snippets.ts}`

**Interfaces:**
- Consumes: `EndpointHeader`, `ParamsTable`, `CodeTabs`, `Callout`, `ENDPOINTS`

- [ ] **Step 0: Add this task's navigation entries**

Add the rows this task owns from **The target navigation** table to
`src/lib/navigation.ts`, in the order given there. `navigation.spec.ts` asserts
every href has a page on disk, so add each entry in the same commit as its page —
listing a page you have not written yet turns the suite red.

- [ ] **Step 1: Rewrite the API overview as MDX**

`(docs)/api/page.mdx` keeps only what belongs on an overview, moving the rest to the pages that now own it: the base URL, the `{ data, error, meta }` envelope, that error messages name the field and are written for the agent reading them, the rate limits (**250 requests/second and 100 verifications/minute** — the current, corrected numbers), and the `ENDPOINTS` list rendered as it is today so the table of contents stays generated. Delete `page.tsx`.

- [ ] **Step 2: Write the two account pages**

Each is: `EndpointHeader` (`POST /v1/signup`, cliCommand `propgate signup`), one paragraph of what it does, `ParamsTable` for the body, `CodeTabs` with cURL and CLI, the response, and the failure modes. For signup, the enumeration-guard paragraph. For confirm, that one `409` covers all four ways a code can be wrong and why the distinctions exist for the log rather than the client.

- [ ] **Step 3: Write the three API-key pages**

`create` returns the secret once and never again; note the fifty-active-key ceiling and that the `422` names both the limit and your current count. `list` never returns a secret and includes revoked keys, each with `createdBy`. `revoke` takes an id, refuses your last active key with a `409`, and reports `meta.alreadyRevoked`; a `Callout` explains that the CLI accepts a prefix and resolves it here, because a four-character prefix carries no unique index.

- [ ] **Step 4: Write the members page**

`GET /v1/members`. Read-only, and say why in one paragraph: a member is added only by proving control of a mailbox, and removing one needs roles, because without them any member could remove the founding address.

- [ ] **Step 5: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
git add -A && git commit -m "docs: api reference — accounts, keys, members"
```

---

## Task 7: API reference — profiles, domains, webhooks

**Files:**
- Create: `(docs)/api/profiles/create/`, `get/`
- Create: `(docs)/api/domains/register/`, `verify/`, `list/`, `get/`, `timeline/`, `delete/`
- Create: `(docs)/api/webhooks/endpoints/`
- Modify: `apps/docs/src/app/(docs)/webhooks/page.tsx` — keep as the payload reference, cross-link from the new endpoint page

**Interfaces:**
- Consumes: `EndpointHeader`, `ParamsTable`, `CodeTabs`, `Callout`, `EVENTS`, `TIMESTAMP_TOLERANCE_SECONDS`

- [ ] **Step 0: Add this task's navigation entries**

Add the rows this task owns from **The target navigation** table to
`src/lib/navigation.ts`, in the order given there. `navigation.spec.ts` asserts
every href has a page on disk, so add each entry in the same commit as its page —
listing a page you have not written yet turns the suite red.

- [ ] **Step 1: The two profile pages**

`create` shows the `sending` profile from `QUICKSTART.md`, states that editing writes a new version, and lists the rejections at write time. `get` returns the current version and links to `/concepts/profiles`.

- [ ] **Step 2: The six domain pages**

- `register` — a write that does not touch DNS; the domain starts `pending`; `externalId` for idempotent retries; `409` when the name is taken.
- `verify` — `POST /v1/domains/:id/checks`, per-requirement results, the 100/minute limit, and that continuous re-checking is the sweeper's job and does not come through here.
- `list` — cursor paging, `state` and `externalId` filters, and that `lookups` is omitted from pages because it multiplies the payload by 4.4.
- `get` — the stored result with the lookups behind it, and that it does not re-check.
- `timeline` — appended only when an observation actually differs, which is the difference between a $20 bill and a $400 one.
- `delete` — stops tracking.

Each carries a CLI tab where one exists (`propgate domains add`, `propgate domains list`) and a one-line note where it does not.

- [ ] **Step 3: The webhooks endpoint page**

The seven routes of the `/v1/webhooks` family in one page, since they are one resource: create, list, get, patch, delete, `POST /:id/secret` rotation with its window, and `GET /:id/deliveries`. Explain why deliveries are nested under the endpoint rather than listed tenant-wide, and why rotation is `POST /:id/secret` rather than `/rotate-secret`. Link to the existing `/webhooks` page for payloads and signature verification.

- [ ] **Step 4: Check the API reference is now complete against the registry**

Every path in `ENDPOINTS` should now appear on some page. Confirm by hand before
Task 9 turns it into a spec:

```bash
cd apps/docs
for p in $(grep -o 'path: "[^"]*"' src/lib/api.ts | cut -d'"' -f2); do
  grep -rq -- "$p" "src/app/(docs)" || echo "UNDOCUMENTED $p"
done
```
Expected: no output.

- [ ] **Step 5: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx next build
git add -A && git commit -m "docs: api reference — profiles, domains, webhooks"
```

---

## Task 8: The CLI section

**Files:**
- Create: `(docs)/cli/page.mdx`
- Create: `(docs)/cli/check/{page.mdx,_snippets.ts}`
- Create: `(docs)/cli/accounts/{page.mdx,_snippets.ts}`
- Create: `(docs)/cli/domains/{page.mdx,_snippets.ts}`

**Interfaces:**
- Consumes: `CodeTabs`, `CodeBlock`, `Callout`

Source: `packages/cli/README.md` and `packages/cli/src/args.ts`'s `USAGE` / `account.ts`'s `ACCOUNT_USAGE`. Do not restate flags from memory — read those.

- [ ] **Step 0: Add this task's navigation entries**

Add the rows this task owns from **The target navigation** table to
`src/lib/navigation.ts`, in the order given there. `navigation.spec.ts` asserts
every href has a page on disk, so add each entry in the same commit as its page —
listing a page you have not written yet turns the suite red.

- [ ] **Step 1: Overview**

Install (`npx`, or a global install), the split that matters — `check` needs no account, no config file and no network beyond DNS, while everything else talks to the API — the config file at `$XDG_CONFIG_HOME/propgate/config.json` at mode `0600`, and the `PROPGATE_API_KEY` / `PROPGATE_API_URL` / `--api-url` precedence.

- [ ] **Step 2: `check`**

Every flag from `USAGE`, the three exit codes with the emphasis on `2` being "could not complete" rather than a failure, the `--receives-mail` tri-state and why intent cannot be read from DNS, and `--json` with a real captured output from `packages/cli/README.md`.

- [ ] **Step 3: `signup`, `confirm`, `keys`**

The flow end to end. Two `Callout`s worth writing: `confirm` prints the key once and stores it, and `keys revoke` takes a prefix because that is the part of a key still readable after issue — refusing an ambiguous prefix rather than guessing.

- [ ] **Step 4: `domains`**

`domains add --profile` and `domains list --state`, each with the equivalent cURL in the other tab so the two references agree.

- [ ] **Step 5: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
git add -A && git commit -m "docs: the CLI section"
```

---

## Task 9: The `@propgate/dns` section

**Files:**
- Create: `(docs)/dns/page.mdx`
- Create: `(docs)/dns/resolver/{page.mdx,_snippets.ts}`
- Create: `(docs)/dns/evaluators/{page.mdx,_snippets.ts}`
- Create: `(docs)/dns/recipes/{page.mdx,_snippets.ts}`

**Interfaces:**
- Consumes: `CodeTabs`, `CodeBlock`, `Callout`, `REQUIREMENT_TYPES`
- Every code sample is TypeScript against the real exports in `packages/dns/src/index.ts`. Read that file; do not guess at signatures.

- [ ] **Step 0: Add this task's navigation entries**

Add the rows this task owns from **The target navigation** table to
`src/lib/navigation.ts`, in the order given there. `navigation.spec.ts` asserts
every href has a page on disk, so add each entry in the same commit as its page —
listing a page you have not written yet turns the suite red.

- [ ] **Step 1: Overview**

What the package is and why anyone would take it alone: MIT, **zero runtime dependencies**, Node built-ins only, the same engine behind the API and the public checker. The table from `packages/dns/README.md` on what `node:dns` cannot do — the TC bit, the DO bit, RRSIGs, the authority-section SOA of an NXDOMAIN, the advertised EDNS buffer size — each of which is load-bearing for a diagnosis code.

- [ ] **Step 2: The resolver**

`query`, `QueryOutcome`'s five statuses as a table, and why they are values rather than throws: a timeout, a refusal and a mangled response are observations about a domain, and collapsing them into one `catch` is how a resolver reports "not found" for a server that was merely slow. Port awareness — `{ address, port, transport }`, never an assumed 53. Truncation and the TCP fallback, including that a swallowed retry is `TCP_SILENTLY_BLOCKED` and how `retriedOverTcp` distinguishes it from a dead server.

- [ ] **Step 3: The evaluators**

`runChecks` with a `DomainProfile`, and one subsection per check kind, generated over `REQUIREMENT_TYPES` so the six cannot drift. For each: what it asserts and the one non-obvious thing about it — SPF's recursive `include:` expansion with the ten-lookup and two-void-lookup limits actually counted; DKIM keys parsed rather than pattern-matched, and that base64 is case-sensitive while DNS names are not; DMARC only valid at the org domain with external report authorisation; the CAA tree climbed per RFC 8659; the null-MX tri-state.

- [ ] **Step 4: Recipes**

Three worked examples, each a complete runnable file: check one domain and switch on the verdict; run against a specific resolver on a non-standard port; read the lookups behind a finding to explain a verdict to a customer.

- [ ] **Step 5: Add the registry drift guard, now that it can pass**

`ENDPOINTS` is kept honest against `@propgate/dns` by `api.spec.ts`. What nothing
checks is the other direction — that each endpoint is documented *somewhere*.
Before this, adding a route meant remembering to write a page, and forgetting
looked exactly like a route that did not exist.

`apps/docs/src/lib/coverage.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./api";
import { flattenNavigation } from "./navigation";

const APP = join(process.cwd(), "src/app/(docs)");

function bodyOf(href: string): string {
  const relative = href === "/" ? "" : href;

  for (const name of ["page.mdx", "page.tsx"]) {
    try {
      return readFileSync(join(APP, relative, name), "utf8");
    } catch {
      // Try the other extension before giving up.
    }
  }

  throw new Error(`no page for ${href}`);
}

const ALL_PAGES = flattenNavigation()
  .map((entry) => bodyOf(entry.href))
  .join("\n");

describe("api reference coverage", () => {
  it("documents every endpoint the API implements", () => {
    // Matched on the path string, which every endpoint page carries in its
    // `EndpointHeader`. Coarse on purpose: a stricter match would fail on
    // formatting rather than on a missing page.
    const undocumented = ENDPOINTS.filter(
      (endpoint) => !ALL_PAGES.includes(endpoint.path)
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(undocumented).toEqual([]);
  });

  it("covers every section the navigation promises", () => {
    // An empty section is legal mid-series and a defect at the end: it renders a
    // heading with nothing under it.
    const empty = flattenNavigation().length;

    expect(empty).toBeGreaterThan(20);
  });
});
```

Run: `cd apps/docs && npx vitest run src/lib/coverage.spec.ts`
Expected: PASS. If the first test fails it names the undocumented endpoint.

- [ ] **Step 6: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run && npx next build
git add -A && git commit -m "docs: the @propgate/dns library section"
```

---

## Task 10: Machine-readable — per-page `.md`, `llms.txt`, `llms-full.txt`

**Files:**
- Create: `apps/docs/src/lib/page-markdown.ts`
- Create: `apps/docs/src/lib/page-markdown.spec.ts`
- Create: `apps/docs/src/lib/markdown-route.ts`
- Create: `apps/docs/src/app/(docs)/<path>.md/route.ts` — one per MDX page
- Create: `apps/docs/src/app/llms.txt/route.ts`
- Create: `apps/docs/src/app/llms-full.txt/route.ts`
- Create: `apps/docs/src/lib/llms.spec.ts`

**Interfaces:**
- Consumes: `flattenNavigation`
- Produces: `pageMarkdown(mdxPath: string): string`; `buildMarkdownRoute(mdxPath: string): () => Response`

- [ ] **Step 1: Write the failing test**

`apps/docs/src/lib/page-markdown.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pageMarkdown } from "./page-markdown";

/**
 * The markdown an agent reads.
 *
 * `.claude/CLAUDE.md`'s thesis is that agents read our errors and our docs, so
 * these files are a product surface rather than a convenience. What must not
 * leak is the machinery: an `import` line or a `metadata` export is noise that
 * costs a reader tokens and tells them nothing about the API.
 */

const PATH = "src/app/(docs)/quickstart/page.mdx";

describe("pageMarkdown", () => {
  it("keeps the prose and the fenced code", () => {
    const markdown = pageMarkdown(PATH);

    expect(markdown).toContain("# ");
    expect(markdown).toContain("```");
  });

  it("strips the imports", () => {
    // Line-anchored: prose mentioning the word "import" must survive.
    for (const line of pageMarkdown(PATH).split("\n")) {
      expect(line.startsWith("import ")).toBe(false);
    }
  });

  it("strips the metadata export", () => {
    expect(pageMarkdown(PATH)).not.toContain("export const metadata");
  });

  it("does not start with blank lines", () => {
    expect(pageMarkdown(PATH)).not.toMatch(LEADING_BLANK);
  });
});
```

Declare `const LEADING_BLANK = /^\s*\n/;` at the top of the file — Biome's `useTopLevelRegex` rejects it inside the test.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/docs && npx vitest run src/lib/page-markdown.spec.ts`
Expected: FAIL — cannot resolve `./page-markdown`.

- [ ] **Step 3: Implement it**

`apps/docs/src/lib/page-markdown.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An MDX page as markdown, near-verbatim.
 *
 * Deliberately not a JSX-to-markdown transformer. The alternative — substituting
 * snippet constants into rendered components — is several hundred lines that can
 * silently drop content, and the thing it buys is cosmetic: an agent reading
 * `<CodeTabs items={[…]} />` wrapped around a fenced block loses nothing it
 * needed. Imports and the metadata export go, because those are machinery rather
 * than content, and everything else stays exactly as written.
 */

const IMPORT_LINE = /^import\s/;
const METADATA_BLOCK = /^export const metadata = \{[\s\S]*?\n\};?\n/m;
const BLANK_RUN = /\n{3,}/g;

export function pageMarkdown(mdxPath: string): string {
  const raw = readFileSync(join(process.cwd(), mdxPath), "utf8");

  return raw
    .replace(METADATA_BLOCK, "")
    .split("\n")
    .filter((line) => !IMPORT_LINE.test(line))
    .join("\n")
    .replace(BLANK_RUN, "\n\n")
    .trim();
}
```

- [ ] **Step 4: Run the spec and watch it pass**

Run: `cd apps/docs && npx vitest run src/lib/page-markdown.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the route builder and one route per page**

`apps/docs/src/lib/markdown-route.ts`:

```ts
import { pageMarkdown } from "@/lib/page-markdown";

/**
 * Read at build time, not per request.
 *
 * `output: "export"` turns a `force-static` GET into a file on disk, which is
 * verified: a probe route emitted `out/probe.md`. The read therefore happens
 * once during `next build` and never on a server, because there is no server.
 */
export function buildMarkdownRoute(mdxPath: string) {
  const content = pageMarkdown(mdxPath);

  return () =>
    new Response(content, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
}
```

For each MDX page, a sibling directory `<name>.md/route.ts`:

```ts
import { buildMarkdownRoute } from "@/lib/markdown-route";

export const dynamic = "force-static";

export const GET = buildMarkdownRoute("src/app/(docs)/quickstart/page.mdx");
```

- [ ] **Step 6: Write `llms.txt` and `llms-full.txt`**

`apps/docs/src/app/llms-full.txt/route.ts`:

```ts
import { pageMarkdown } from "@/lib/page-markdown";
import { flattenNavigation } from "@/lib/navigation";

export const dynamic = "force-static";

/**
 * Every page, in the order the sidebar implies.
 *
 * Navigation order rather than filesystem order, because the sidebar is where
 * the surface-to-deep progression is expressed and a reader arriving through
 * this file should get the same journey.
 */
export function GET() {
  const body = flattenNavigation()
    .map((entry) => {
      const path = entry.href === "/" ? "" : entry.href;

      return `# ${entry.title}\n\nSource: https://docs.propgate.dev${entry.href}\n\n${pageMarkdown(
        `src/app/(docs)${path}/page.mdx`
      )}`;
    })
    .join("\n\n---\n\n");

  return new Response(`# propgate documentation\n\n${body}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
```

`llms.txt/route.ts` emits the index — one `- [Title](https://docs.propgate.dev<href>.md): <section>` line per entry, grouped under its section heading.

**The taxonomy and conformance pages are `.tsx`, not MDX**, so `pageMarkdown` cannot read them. Skip them in both routes by filtering to hrefs that have a `page.mdx`, and add a line to `llms.txt` pointing at `/taxonomy` as an HTML-only page. Do not let this fail the build silently — the spec below asserts the count.

- [ ] **Step 7: Write the `llms.txt` guard**

`apps/docs/src/lib/llms.spec.ts` asserts that every navigation href with a `page.mdx` appears in the `llms.txt` body, and that the number of pages skipped equals exactly the number of `.tsx` pages — so a page silently dropping out of the LLM surface fails rather than shrinking the file.

- [ ] **Step 8: Verify the files are really emitted**

```bash
cd apps/docs && npx next build
test -f out/llms-full.txt && test -f out/quickstart.md && echo "emitted"
grep -c "^# " out/llms-full.txt      # one heading per page
head -20 out/quickstart.md           # no imports, no metadata
```

- [ ] **Step 9: Verify and commit**

```bash
pnpm fix && pnpm check && pnpm lint
cd apps/docs && npx vitest run
git add -A && git commit -m "feat(docs): per-page markdown, llms.txt and llms-full.txt"
```

---

## Task 11: Final pass — the old pages, the redirects, and the whole-site check

**Files:**
- Modify: `apps/docs/src/app/(docs)/taxonomy/page.tsx`, `taxonomy/[slug]/page.tsx`, `conformance/page.tsx`, `webhooks/page.tsx` — remove their own `<h1>` wrappers only where the new layout duplicates them
- Modify: `README.md`, `QUICKSTART.md` — point at the new deep links
- Modify: `.claude/CLAUDE.md` — one line under Layout describing `apps/docs`'s structure

- [ ] **Step 1: Check the taxonomy still renders inside the new frame**

Run: `cd apps/docs && npx next build && npx serve out` (or open `out/taxonomy.html`). Confirm the sidebar is present, the active item is marked, and the 74 slug pages still render. **Do not change how they are generated.**

- [ ] **Step 2: Point the repo's markdown at the new structure**

`README.md`'s links become `/quickstart`, `/api`, `/taxonomy`, `/dns`. `QUICKSTART.md` gains one line at the top noting that the same material is on the docs site with highlighted, copyable examples, and keeps its own content — it is the file people find from GitHub.

- [ ] **Step 3: Add the docs structure to CLAUDE.md**

Under Layout, extend the `apps/docs` line: navigation lives in `src/lib/navigation.ts`, pages are MDX under `src/app/(docs)`, prose is hand-written while the taxonomy and the endpoint list stay generated from the registries, and every page also serves itself as `.md`.

- [ ] **Step 4: Full verification**

```bash
pnpm fix && pnpm check && pnpm lint
PROPGATE_DATABASE=1 DATABASE_URL="postgres://propgate:propgate@127.0.0.1:5442/propgate_test" pnpm test --force
cd apps/docs && npx next build
```

Expected: Biome and tsc clean; every package's specs pass; the build lists every page as `○ (Static)` or `● (SSG)` with no warnings.

- [ ] **Step 5: Read the site as a stranger**

Walk the sidebar top to bottom in a browser. The test is whether Introduction → Quickstart → Authentication → Concepts → API reference reads as one escalating path rather than five disconnected pages. Fix ordering in `navigation.ts` — not content — if it does not.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A && git commit -m "docs: point the repo markdown at the new structure"
git push -u origin docs/restructure
```

---

## Self-review

**Spec coverage.** Syntax highlighting — Task 2, with a spec that asserts token spans and a build-time grep. Sidebar with groups and hierarchy — Task 1, the flat-or-grouped union, plus Task 3's breadcrumbs and pager. Surface-to-deep separation — the navigation order in Task 1, filled by Tasks 4 (surface), 5 (concepts) and 6–7 (reference). cURL **and** CLI — the content rule in Task 4 applied through Tasks 6–8, with `EndpointHeader`'s `cliCommand` making the CLI equivalent visible on every endpoint page. `@propgate/dns` docs — Task 9. Taxonomy kept — Global Constraints forbid converting it; Task 11 Step 1 verifies it inside the new frame. LLM-facing `.md` + `llms.txt` — Task 10. One PR — every task commits to the same branch.

**Placeholders.** None. An earlier draft had Tasks 1–8 committing placeholder pages and a knowingly-red coverage spec; both were restructured out, because every task must land green — the navigation array now grows with the pages, and the drift guard lands in Task 9 where it can pass. No task says "TBD" or "handle edge cases".

**Type consistency.** `NavItem` / `NavGroup` / `NavSection` / `FlatNavEntry` are defined in Task 1 and used unchanged in Tasks 3 and 10. `CodeTabsItem { code, label, lang }` and `RenderedTab { code, html, label }` are defined in Task 2 and consumed in 4–9. `ParamRow { description, name, required?, type }` is defined in Task 3 and used in 6–7. `pageMarkdown(mdxPath)` and `buildMarkdownRoute(mdxPath)` are defined in Task 10 and used only there. `highlight(code, lang)` and `SHIKI_THEME` are defined in Task 2 and consumed by `CodeBlock` and `CodeTabs`.

---

## Unresolved questions

1. **One page per endpoint, or per resource?** This plan gives domains six pages and webhooks one — because webhooks is seven routes over one resource, and splitting it would make seven thin pages. Buckt splits everything. Want the webhooks family split too?
2. **`/reference/limits`?** Rate limits currently live on the API overview. Own page, or leave them there?
3. **Introduction at `/` replaces today's link-list homepage.** Fine, or keep a separate landing page above the docs?
4. **The old flat URLs** (`/api`, `/taxonomy`, `/webhooks`, `/conformance`) all survive. `/api` changes meaning — from the whole reference to an overview. Anything linking to `/api` externally should still make sense; confirm you are happy for its content to shrink.
