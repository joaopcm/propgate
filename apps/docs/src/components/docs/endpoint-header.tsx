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
