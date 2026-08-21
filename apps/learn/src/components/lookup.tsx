import { FIXTURE_SERVERS, type FixtureRole } from "@propgate/dns-fixtures";
import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

/**
 * One exercise: a query the reader runs, and what to notice in the answer.
 *
 * Three decisions worth defending.
 *
 * **It prints the address and port from `FIXTURE_SERVERS`** rather than from a
 * string in the prose. The fixture tier's topology is one table in
 * `packages/dns-fixtures/src/manifest.ts`, and a course that hardcoded
 * `127.0.0.3` would go wrong the day that table changed — silently, because a
 * wrong address times out rather than erroring.
 *
 * **It always prints `-p`,** even though every fixture server listens on 53 by
 * default. Invariant 5 says a port is never assumed, and an exercise that
 * quietly relied on the default while the unit was explaining why you cannot
 * would be teaching one thing and demonstrating another.
 *
 * **It does not print the answer.** `expect` says what shape to look for and
 * `notice` says what it means, both after the fact. The reader has to actually
 * run the query, which is the entire difference between this and a screenshot.
 */
export function Lookup({
  flags,
  name,
  notice,
  server,
  shape,
  type,
}: {
  /** Extra `dig` flags, e.g. `+ignore` where a TCP retry would hide the point. */
  readonly flags?: string;
  readonly name: string;
  /** What it means. Collapsed until the reader asks. */
  readonly notice: ReactNode;
  readonly server: FixtureRole;
  /** What to look for in the answer, in one line. */
  readonly shape: string;
  readonly type: string;
}) {
  const target = FIXTURE_SERVERS[server];
  const command = [
    "dig",
    `@${target.address}`,
    "-p",
    String(target.port),
    ...(flags === undefined ? [] : [flags]),
    type,
    name,
  ].join(" ");

  return (
    <section className="my-6 border-rule border-l-2 pl-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
          Run this — {server}
        </p>
        <CopyButton value={command} />
      </div>
      <pre className="mt-2 overflow-x-auto font-mono text-[0.8125rem] text-foreground leading-6">
        {command}
      </pre>
      <p className="mt-2 font-mono text-muted-foreground text-xs leading-6">
        {shape}
      </p>
      <details className="group mt-2">
        <summary className="cursor-pointer font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest transition-colors hover:text-foreground">
          What to notice
        </summary>
        <div className="mt-2 text-muted-foreground text-sm leading-7">
          {notice}
        </div>
      </details>
    </section>
  );
}
