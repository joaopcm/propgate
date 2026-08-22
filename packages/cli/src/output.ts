import { EXIT_PROBLEM, EXIT_USAGE } from "./exit";

export interface Context {
  readonly apiKey: string | undefined;
  readonly apiUrl: string;
  readonly apiUrlGiven: boolean;
  readonly interactive: boolean;
  readonly json: boolean;
}

export function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function fail(message: string): number {
  process.stderr.write(`propgate: ${message}\n`);

  return EXIT_PROBLEM;
}

export function usage(message: string): number {
  process.stderr.write(`propgate: ${message}\n`);

  return EXIT_USAGE;
}

export function reportApiError(
  status: number,
  message: string | undefined,
  fallback: string
): number {
  if (status === 401) {
    return fail(
      `${message ?? fallback}\nRun \`propgate confirm\` again, or set PROPGATE_API_KEY.`
    );
  }

  return fail(message ?? fallback);
}

export function requireKey(context: Context): string | null {
  if (context.apiKey === undefined) {
    process.stderr.write(
      "propgate: no API key. Run `propgate signup --email you@example.com`, then `propgate confirm`, or set PROPGATE_API_KEY.\n"
    );

    return null;
  }

  return context.apiKey;
}

export function json(body: unknown): number {
  out(JSON.stringify(body, null, 2));

  return 0;
}
