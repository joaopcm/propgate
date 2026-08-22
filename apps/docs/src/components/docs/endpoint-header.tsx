import { ENDPOINTS } from "@/lib/api";

export const METHOD_STYLE = {
  DELETE: "text-[var(--color-destructive)]",
  GET: "text-muted-foreground",
  PATCH: "text-[var(--color-warning)]",
  POST: "text-[var(--color-warning)]",
} as const;

export type Method = keyof typeof METHOD_STYLE;

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
