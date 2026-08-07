import { ENDPOINTS } from "@/lib/api";

export const METHOD_STYLE = {
  DELETE: "text-[var(--color-destructive)]",
  GET: "text-muted-foreground",
  PATCH: "text-[var(--color-warning)]",
  POST: "text-[var(--color-warning)]",
} as const;

export type Method = keyof typeof METHOD_STYLE;

/**
 * Method, path, and the CLI command that does the same thing.
 *
 * The CLI equivalent sits here rather than in a separate section because the two
 * are one decision for the reader — "how do I do this from a script" and "how do
 * I do this by hand" — and splitting them is how a CLI ends up undocumented.
 *
 * It is **looked up** rather than passed in. Twenty-two pages each repeating the
 * command by hand is twenty-two places to forget when one is renamed; `ENDPOINTS`
 * already carries it, and `Endpoint.cli` is required, so an endpoint cannot exist
 * without one. `cliCommand` stays as an override for the rare page that documents
 * something the registry does not.
 */
export function EndpointHeader({
  cliCommand,
  method,
  path,
}: {
  cliCommand?: string;
  method: Method;
  path: string;
}) {
  const cli =
    cliCommand ??
    ENDPOINTS.find(
      (endpoint) => endpoint.method === method && endpoint.path === path
    )?.cli;

  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-border border-b pb-3">
      <span
        className={`font-mono text-[0.6875rem] uppercase tracking-widest ${METHOD_STYLE[method]}`}
      >
        {method}
      </span>
      <code className="font-mono text-sm">{path}</code>
      {cli ? (
        <code className="ml-auto font-mono text-muted-foreground text-xs">
          {cli}
        </code>
      ) : null}
    </div>
  );
}
