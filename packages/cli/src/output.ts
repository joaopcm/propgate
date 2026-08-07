import { EXIT_PROBLEM, EXIT_USAGE } from "./exit";

/**
 * Writing to the terminal, and the shape every command shares.
 *
 * Lifted out of `account.ts` unchanged when that file dissolved into
 * `commands/`. The phrasing of these messages is load-bearing — `reportApiError`
 * repeats the API's own words rather than inventing a second vocabulary for the
 * same failure — so they moved rather than being rewritten.
 */

export interface Context {
  readonly apiKey: string | undefined;
  readonly apiUrl: string;
  /**
   * Whether `--api-url` was typed, as opposed to defaulted or inherited from the
   * environment. `check` needs the distinction: the flag means nothing without
   * `--remote`, and quietly accepting it would let someone believe they had
   * pointed the command at a local stack.
   */
  readonly apiUrlGiven: boolean;
  /** Whether there is a person here to answer a question. */
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

/**
 * You asked for something impossible, and nothing was attempted.
 *
 * Separate from `fail` because the codes differ, and the difference is the point:
 * a script cannot tell a typo from a rejection when both exit 1.
 */
export function usage(message: string): number {
  process.stderr.write(`propgate: ${message}\n`);

  return EXIT_USAGE;
}

/** Print an API error the way the API phrased it. */
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

/** The whole envelope, indented, for `--json`. */
export function json(body: unknown): number {
  out(JSON.stringify(body, null, 2));

  return 0;
}
