import type { Metadata } from "next";
import Link from "next/link";
import { type Entry, families } from "@/lib/taxonomy";

/**
 * The index.
 *
 * Grouped by family rather than listed flat: seventy-odd codes on one page is a
 * wall, and the question someone arrives with is "what can go wrong with SPF",
 * not "what is the alphabetically third code".
 */

export const metadata: Metadata = {
  description:
    "Every DNS misconfiguration propgate detects, what it means, and which fixture proves it.",
  title: "Diagnosis taxonomy",
};

const SEVERITY_STYLE = {
  error: "text-[var(--color-destructive)]",
  info: "text-muted-foreground",
  warning: "text-[var(--color-warning)]",
} as const;

function Row({ entry }: { entry: Entry }) {
  const { definition } = entry;

  return (
    <li className="border-border border-b last:border-0">
      <Link
        className="group flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
        href={`/taxonomy/${definition.slug}`}
      >
        <code className="font-mono text-sm group-hover:underline">
          {definition.code}
        </code>
        <span className="flex-1 text-muted-foreground text-sm leading-6">
          {definition.summary}
        </span>
        <span
          className={`shrink-0 font-mono text-[0.6875rem] uppercase tracking-widest ${SEVERITY_STYLE[definition.severity]}`}
        >
          {definition.severity}
        </span>
      </Link>
    </li>
  );
}

export default function TaxonomyPage() {
  const groups = families();
  const total = groups.reduce(
    (count, group) => count + group.entries.length,
    0
  );

  return (
    <>
      <h1 className="mb-6 font-semibold text-3xl tracking-tight">
        Diagnosis taxonomy
      </h1>

      <p className="mb-3 text-muted-foreground leading-7">
        {total} codes. Each one is a stable public contract: switching on a code
        is supported, and we treat changing or removing one as a breaking
        change.
      </p>
      <p className="mb-10 text-muted-foreground leading-7">
        Every code is either produced by a fixture in our test harness or
        carries a written reason why it cannot be. This page is generated from
        the same two tables the test suite reads, so it cannot describe a code
        that does not exist or omit one that does.
      </p>

      <nav className="mb-12 flex flex-wrap gap-x-4 gap-y-2">
        {groups.map((group) => (
          <a
            className="font-mono text-muted-foreground text-xs uppercase tracking-widest hover:text-foreground"
            href={`#${group.id}`}
            key={group.id}
          >
            {group.title}
          </a>
        ))}
      </nav>

      {groups.map((group) => (
        <section className="mb-14" id={group.id} key={group.id}>
          <h2 className="font-medium text-xl tracking-tight">{group.title}</h2>
          <p className="mt-1 mb-4 text-muted-foreground text-sm leading-6">
            {group.blurb}
          </p>

          <ul>
            {group.entries.map((entry) => (
              <Row entry={entry} key={entry.definition.code} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
