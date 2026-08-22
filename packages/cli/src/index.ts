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

function runAsProgram(): boolean {
  const [, entry] = process.argv;

  if (entry === undefined) {
    return false;
  }

  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (runAsProgram()) {
  process.exitCode = await main(process.argv.slice(2));
}
