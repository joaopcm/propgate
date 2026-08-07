import { signature } from "../args";
import { type Command, commandName } from "../command";
import { checkCommand } from "./check";
import { domainsCommands } from "./domains";
import { keysCommands } from "./keys";
import { membersCommand } from "./members";
import { profilesCommands } from "./profiles";
import { confirmCommand, signupCommand } from "./signup";
import { webhooksCommands } from "./webhooks";

/**
 * Every command, in one list.
 *
 * This is the whole surface: twenty-three commands covering the API's
 * twenty-two endpoints, plus the local check. `GET /health` is not here on
 * purpose — it is a container healthcheck, not something a person runs.
 *
 * Help text, option tables and the coverage spec are all derived from this
 * array. Nothing about a command is written down twice.
 */

export const COMMANDS: readonly Command[] = [
  checkCommand,
  signupCommand,
  confirmCommand,
  ...keysCommands,
  membersCommand,
  ...profilesCommands,
  ...domainsCommands,
  ...webhooksCommands,
];

export type Match =
  | { readonly command: Command; readonly kind: "command" }
  | { readonly family: string; readonly kind: "family" }
  | { readonly kind: "none" }
  | { readonly kind: "unknown"; readonly word: string };

const FAMILIES = [
  ...new Set(
    COMMANDS.filter((command) => command.path.length > 1).map(
      (command) => command.path[0] as string
    )
  ),
];

/**
 * Which command was asked for.
 *
 * Two words before one, so `domains list` never resolves to a `domains` that
 * does not exist. A family name on its own is not an error — it is someone who
 * wants to see what is under it.
 */
export function lookup(words: readonly string[]): Match {
  const [first, second] = words;

  if (first === undefined) {
    return { kind: "none" };
  }

  const pair = COMMANDS.find(
    (command) =>
      command.path.length === 2 &&
      command.path[0] === first &&
      command.path[1] === second
  );

  if (pair !== undefined) {
    return { command: pair, kind: "command" };
  }

  const single = COMMANDS.find(
    (command) => command.path.length === 1 && command.path[0] === first
  );

  if (single !== undefined) {
    return { command: single, kind: "command" };
  }

  return FAMILIES.includes(first)
    ? { family: first, kind: "family" }
    : { kind: "unknown", word: first };
}

/** How many leading positionals the match consumed. */
export function pathLength(command: Command): number {
  return command.path.length;
}

const NAME_COLUMN = 26;

function line(command: Command): string {
  return `  ${commandName(command).padEnd(NAME_COLUMN)}${command.summary.split(".")[0]}.`;
}

export function familyUsage(family: string): string {
  const members = COMMANDS.filter((command) => command.path[0] === family);

  return `propgate ${family}\n\n${members.map((command) => `  ${signature(command)}`).join("\n")}\n\nRun \`propgate ${family} <command> --help\` for the options.\n`;
}

/**
 * The top-level help, generated rather than written.
 *
 * A hand-kept list is how the previous one came to omit half the surface: there
 * was nothing that failed when a command was added and the paragraph was not.
 */
export function usage(): string {
  const local = COMMANDS.filter((command) => command.path.length === 1);
  const grouped = FAMILIES.map(
    (family) =>
      `${family}\n${COMMANDS.filter((command) => command.path[0] === family)
        .map(line)
        .join("\n")}`
  );

  return [
    "propgate — DNS diagnosis and domain verification from the terminal",
    "",
    "  propgate check <domain> [options]",
    "",
    local.map(line).join("\n"),
    "",
    grouped.join("\n\n"),
    "",
    "Options",
    "  --json                    Machine-readable output. Implies no prompting.",
    "  --api-url <url>           The API to talk to. Defaults to https://api.propgate.dev.",
    "  --help, --version",
    "",
    "Any command run without a required flag asks for it, when there is a terminal",
    "to ask in. With --json, in CI, or with PROPGATE_NO_INPUT=1, it says which flag",
    "is missing and exits 64 instead.",
    "",
    "Credentials",
    "  `confirm` stores your key in $XDG_CONFIG_HOME/propgate/config.json, mode 0600.",
    "  PROPGATE_API_KEY overrides it; PROPGATE_API_URL overrides the URL.",
    "",
    "  `propgate check` needs none of this — it resolves locally.",
    "",
    "Exit codes",
    "  0  nothing to fix        2  a check could not be completed",
    "  1  something is wrong    64 the arguments were wrong    130 cancelled",
    "",
  ].join("\n");
}
