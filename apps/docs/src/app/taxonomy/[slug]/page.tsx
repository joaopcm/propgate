import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allEntries, entryBySlug } from "@/lib/taxonomy";

/**
 * One page per code, addressed by slug.
 *
 * The slug is not decoration: the API and the CLI put it on every finding so a
 * consumer can link straight here without shipping a copy of the taxonomy. This
 * is the other end of that link.
 */

const SEVERITY_STYLE = {
  error: "text-[var(--color-destructive)]",
  info: "text-muted-foreground",
  warning: "text-[var(--color-warning)]",
} as const;

const SEVERITY_MEANING = {
  error: "Something is wrong and mail or certificates are affected.",
  info: "An observation. Whether it matters depends on what the domain is for.",
  warning: "Working today, and one change away from not working.",
} as const;

interface Params {
  readonly params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return allEntries().map((entry) => ({ slug: entry.definition.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const entry = entryBySlug((await params).slug);

  if (entry === undefined) {
    return { title: "Unknown code" };
  }

  return {
    description: entry.definition.summary,
    title: entry.definition.code,
  };
}

export default async function CodePage({ params }: Params) {
  const entry = entryBySlug((await params).slug);

  if (entry === undefined) {
    notFound();
  }

  const { definition, fixtures, unreproducible } = entry;

  return (
    <>
      <Link
        className="font-mono text-muted-foreground text-xs uppercase tracking-widest hover:text-foreground"
        href="/taxonomy"
      >
        ← taxonomy
      </Link>

      <h1 className="mt-6 font-mono text-2xl tracking-tight">
        {definition.code}
      </h1>

      <p
        className={`mt-2 font-mono text-xs uppercase tracking-widest ${SEVERITY_STYLE[definition.severity]}`}
      >
        {definition.severity}
      </p>

      <p className="mt-6 text-lg leading-8">{definition.summary}</p>

      <p className="mt-2 text-muted-foreground text-sm leading-6">
        {SEVERITY_MEANING[definition.severity]}
      </p>

      <section className="mt-12">
        <h2 className="font-medium text-sm uppercase tracking-widest">
          How we know
        </h2>

        {fixtures.length > 0 ? (
          <ul className="mt-4 space-y-6">
            {fixtures.map((fixture) => (
              <li key={fixture.zone}>
                <p className="font-mono text-sm">{fixture.zone}</p>
                <p className="mt-1 text-muted-foreground text-sm leading-6">
                  {fixture.reason}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {unreproducible === undefined ? null : (
          <div className="mt-4">
            <p className="text-sm leading-6">
              No fixture produces this locally.
            </p>
            <p className="mt-1 text-muted-foreground text-sm leading-6">
              {unreproducible}
            </p>
          </div>
        )}

        {fixtures.length === 0 && unreproducible === undefined ? (
          <p className="mt-4 text-muted-foreground text-sm leading-6">
            No fixture is recorded for this code, which the coverage guard in
            the test suite does not allow — if you are reading this, something
            is wrong with the build.
          </p>
        ) : null}
      </section>
    </>
  );
}
