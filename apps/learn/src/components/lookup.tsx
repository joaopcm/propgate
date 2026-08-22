import { FIXTURE_SERVERS, type FixtureRole } from "@propgate/dns-fixtures";
import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

export function Lookup({
  flags,
  name,
  notice,
  server,
  shape,
  type,
}: {
  readonly flags?: string;
  readonly name: string;
  readonly notice: ReactNode;
  readonly server: FixtureRole;
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
