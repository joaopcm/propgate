import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { optionsFor, readArgs, usageFor } from "./args";
import type { Command } from "./command";
import { familyUsage, usage as globalUsage, lookup } from "./commands/registry";
import { credentials } from "./config";
import { EXIT_CANCELLED, EXIT_PROBLEM, EXIT_USAGE } from "./exit";
import { type Context, fail, requireKey } from "./output";
import { cancelled } from "./prompt";
import { isInteractive, resolve, surroundings } from "./resolve";
import { version } from "./version";

/**
 * Dispatch.
 *
 * Every command is a `Command` literal in `commands/registry.ts`, and this file
 * does the same four things for each of them: find it, parse its own flags,
 * fill in what is missing, run it. Adding an endpoint touches the registry and
 * nothing here.
 */

/**
 * Positionals before we know which option table applies.
 *
 * `strict: false` because the command has not been identified yet, so no table
 * can be the right one — `propgate webhooks rotate --window-hours 0` would fail
 * on an unknown flag if this pass judged flags. It does not: it only finds the
 * words, and the real parse immediately after is strict.
 */
function words(argv: readonly string[]): {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
} {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      args: [...argv],
      strict: false,
    });

    return { positionals, values };
  } catch {
    return { positionals: [], values: {} };
  }
}

function wants(
  values: Readonly<Record<string, unknown>>,
  flag: string
): boolean {
  return values[flag] === true;
}

async function dispatch(
  command: Command,
  argv: readonly string[]
): Promise<number> {
  const read = readArgs(argv, optionsFor(command));

  if (!read.ok) {
    process.stderr.write(`propgate: ${read.message}\n\n${usageFor(command)}`);

    return EXIT_USAGE;
  }

  if (read.values.help === true) {
    process.stdout.write(usageFor(command));

    return 0;
  }

  const json = read.values.json === true;
  const givenApiUrl = read.values["api-url"];
  let context: Context;

  try {
    const resolved = credentials({
      apiUrl: typeof givenApiUrl === "string" ? givenApiUrl : undefined,
    });

    context = {
      apiKey: resolved.apiKey,
      apiUrl: resolved.apiUrl,
      apiUrlGiven: typeof givenApiUrl === "string",
      interactive: isInteractive({ json, where: surroundings() }),
      json,
    };
  } catch (cause) {
    return fail((cause as Error).message);
  }

  if (command.authenticated && requireKey(context) === null) {
    return EXIT_PROBLEM;
  }

  const resolution = await resolve(
    command,
    {
      // The words that named the command are not arguments to it.
      positionals: read.positionals.slice(command.path.length),
      values: read.values,
    },
    { interactive: context.interactive }
  );

  if (resolution.kind === "cancelled") {
    await cancelled();

    return EXIT_CANCELLED;
  }

  if (resolution.kind === "invalid") {
    process.stderr.write(`propgate: ${resolution.message}\n`);

    return EXIT_USAGE;
  }

  if (resolution.kind === "missing") {
    process.stderr.write(
      `propgate: ${resolution.message}\n\n${usageFor(command)}`
    );

    return EXIT_USAGE;
  }

  return await command.run(resolution.input, context);
}

export async function main(argv: readonly string[]): Promise<number> {
  const { positionals, values } = words(argv);

  /**
   * Before the help branch, and that order is the whole point.
   *
   * `--version` arrives with no positionals, so the "no arguments means help"
   * check below swallowed it: `propgate --version` printed usage in every release
   * that has ever shipped. Nothing caught it because the version path had no spec
   * and the constant it printed was stale anyway, so neither half of the feature
   * worked and each hid the other.
   */
  if (positionals.length === 0) {
    if (wants(values, "version") || wants(values, "v")) {
      process.stdout.write(`${version()}\n`);

      return 0;
    }

    process.stdout.write(globalUsage());

    return 0;
  }

  const match = lookup(positionals);

  if (match.kind === "unknown") {
    process.stderr.write(
      `propgate: unknown command: ${match.word}\n\n${globalUsage()}`
    );

    return EXIT_USAGE;
  }

  if (match.kind === "family") {
    // A family named alone is someone asking what is under it, not a mistake.
    const [, subcommand] = positionals;

    process.stderr.write(
      subcommand === undefined
        ? familyUsage(match.family)
        : `propgate: ${match.family} has no "${subcommand}" command\n\n${familyUsage(match.family)}`
    );

    return subcommand === undefined ? 0 : EXIT_USAGE;
  }

  if (match.kind === "none") {
    process.stdout.write(globalUsage());

    return 0;
  }

  return await dispatch(match.command, argv);
}

/**
 * Whether this file was run as a program, rather than imported by a spec.
 *
 * **The previous version of this guard made every published release a silent
 * no-op.** It asked whether `process.argv[1]` ended in `index.js`, and npm links
 * a package's bin as a symlink — `.bin/propgate` → `dist/index.js`. Node reports
 * `argv[1]` as the path it was *invoked* by, not the file that path resolves to,
 * so under `npx @propgate/cli` the check saw `.../.bin/propgate`, decided this
 * was an import, and exited 0 having printed nothing. Every documented
 * invocation went through that symlink.
 *
 * Comparing realpaths is what makes it true in every case that matters: the
 * POSIX symlink, `node dist/index.js` with a relative path, and the Windows
 * `.cmd` shim that passes the script path directly. A spec importing this module
 * still sees the test runner in `argv[1]` and correctly declines to run.
 */
function runAsProgram(): boolean {
  const [, entry] = process.argv;

  if (entry === undefined) {
    return false;
  }

  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    // `argv[1]` naming something unreadable means we were not started from it.
    return false;
  }
}

// tsup adds the shebang; this guard keeps the module importable from tests.
if (runAsProgram()) {
  process.exitCode = await main(process.argv.slice(2));
}
