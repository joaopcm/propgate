import {
  type Command,
  commandName,
  type Field,
  type FieldValue,
  type Input,
  inputFrom,
} from "./command";
import {
  askConfirm,
  askMultiselect,
  askSelect,
  askText,
  CANCELLED,
} from "./prompt";

/**
 * Turning parsed flags into a complete set of arguments, one of three ways:
 * the flag was given, a person answered a question, or we refuse.
 *
 * The refusal is the part worth getting right. A CLI that blocks on stdin
 * because a flag was missing is worse than one that errors — it hangs a CI job
 * until the runner's timeout, with no output saying why. So the interactive
 * decision is made once, explicitly, from things that cannot be true on a build
 * agent, and everything else follows from that boolean.
 */

export interface Surroundings {
  readonly env: NodeJS.ProcessEnv;
  readonly stdinTty: boolean;
  readonly stdoutTty: boolean;
}

export function surroundings(): Surroundings {
  return {
    env: process.env,
    stdinTty: process.stdin.isTTY === true,
    stdoutTty: process.stdout.isTTY === true,
  };
}

/**
 * Whether there is a person here to answer a question.
 *
 * `--json` counts as "no" on its own. Asking for machine-readable output says
 * the output is going somewhere that cannot type, and prompting into a pipe
 * produces a document with a half-drawn select list at the top of it.
 *
 * `PROPGATE_NO_INPUT=1` is the escape hatch for the case none of the other
 * signals catch: a wrapper script run from an interactive shell.
 */
export function isInteractive(options: {
  readonly json: boolean;
  readonly where: Surroundings;
}): boolean {
  const { env } = options.where;

  return (
    options.where.stdinTty &&
    options.where.stdoutTty &&
    !options.json &&
    env.PROPGATE_NO_INPUT !== "1" &&
    env.CI !== "true"
  );
}

export type Resolution =
  | { readonly kind: "cancelled" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "missing"; readonly message: string }
  | { readonly input: Input; readonly kind: "ok" };

export interface ParsedArguments {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}

/** `--a`, `--a and --b`, `--a, --b and --c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Repeatable flags and comma-separated ones both arrive here as one list. */
function splitList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];

  return entries
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function choiceValues(field: Field): readonly string[] {
  return (field.choices ?? []).map((choice) => choice.value);
}

function rejectUnknown(field: Field, given: readonly string[]): string | null {
  const allowed = choiceValues(field);
  const unknown = given.filter((entry) => !allowed.includes(entry));

  if (unknown.length === 0) {
    return null;
  }

  return `--${field.flag} must be one of ${allowed.join(", ")}, got ${listed(
    unknown.map((entry) => `"${entry}"`)
  )}`;
}

interface Read {
  readonly error?: string;
  readonly value: FieldValue;
}

function readMultiselect(field: Field, raw: unknown): Read {
  const given = splitList(raw);

  if (given.length === 0) {
    // Given but empty is a different mistake from not given: `--only ""` was an
    // attempt to say something, and silently running every check instead is not
    // what it said.
    return raw === undefined
      ? { value: undefined }
      : { error: `--${field.flag} needs at least one value`, value: undefined };
  }

  const error = rejectUnknown(field, given);

  return error === null ? { value: given } : { error, value: undefined };
}

function readRepeatable(raw: unknown): Read {
  const given = Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];

  return { value: given.length === 0 ? undefined : given };
}

function readSingle(field: Field, raw: unknown): Read {
  // Last wins for a flag given twice. `parseArgs` keeps both; the later one is
  // what someone meant when they corrected themselves on a command line.
  const single = Array.isArray(raw) ? raw.at(-1) : raw;

  if (typeof single !== "string" || single.trim() === "") {
    return { value: undefined };
  }

  const trimmed = single.trim();

  if (field.kind === "select") {
    const error = rejectUnknown(field, [trimmed]);

    if (error !== null) {
      return { error, value: undefined };
    }
  }

  const complaint = field.validate?.(trimmed);

  return complaint === undefined
    ? { value: trimmed }
    : { error: `--${field.flag}: ${complaint}`, value: undefined };
}

/**
 * Read one field off the parsed flags.
 *
 * Returns `undefined` for "not given" — distinct from a `false` boolean, which is
 * a real answer, and from `""`, which is not.
 */
function fromFlags(
  field: Field,
  values: Readonly<Record<string, unknown>>
): Read {
  const raw = values[field.flag];

  if (field.kind === "boolean") {
    return { value: raw === true ? true : undefined };
  }

  if (field.kind === "multiselect") {
    return readMultiselect(field, raw);
  }

  return field.repeatable === true
    ? readRepeatable(raw)
    : readSingle(field, raw);
}

async function ask(field: Field): Promise<FieldValue | typeof CANCELLED> {
  if (field.kind === "boolean") {
    const answer = await askConfirm(field.prompt, false);

    return answer === CANCELLED ? CANCELLED : answer;
  }

  if (field.kind === "select") {
    return await askSelect(field);
  }

  if (field.kind === "multiselect") {
    const answer = await askMultiselect(field);

    return answer === CANCELLED ? CANCELLED : [...answer];
  }

  const answer = await askText(field);

  if (answer === CANCELLED) {
    return CANCELLED;
  }

  return field.repeatable === true ? [answer] : answer;
}

/** Nothing a caller typed can be read as the wrong number of arguments. */
function countPositionals(
  command: Command,
  positionals: readonly string[]
): string | null {
  const name = commandName(command);

  if (positionals.length > 1) {
    return `${name} takes one ${command.positional === undefined ? "argument" : command.positional.name}, got ${positionals.length}`;
  }

  if (command.positional === undefined && positionals.length > 0) {
    return `${name} takes no arguments, got "${positionals[0]}"`;
  }

  return null;
}

interface FromFlags {
  readonly error?: string;
  /** Declared, absent, and worth asking about. */
  readonly missing: readonly Field[];
  readonly values: Record<string, FieldValue>;
}

function readFields(
  command: Command,
  given: Readonly<Record<string, unknown>>,
  interactive: boolean
): FromFlags {
  const values: Record<string, FieldValue> = {};
  const missing: Field[] = [];

  for (const field of command.fields) {
    const read = fromFlags(field, given);

    if (read.error !== undefined) {
      return { error: read.error, missing: [], values };
    }

    if (read.value === undefined) {
      // Optional-but-offered fields are an interactive courtesy; a script that
      // did not pass one is not missing anything.
      if (
        field.required ||
        (interactive && field.promptWhenOptional === true)
      ) {
        missing.push(field);
      }
    } else {
      values[field.flag] = read.value;
    }
  }

  return { missing, values };
}

/** Ask for everything absent, in declaration order. */
async function askFor(
  command: Command,
  state: { positional: string | undefined; values: Record<string, FieldValue> },
  missing: readonly Field[]
): Promise<"cancelled" | "ok"> {
  const { positional } = command;

  if (state.positional === undefined && positional !== undefined) {
    const answer = await askText({
      describe: positional.describe,
      flag: positional.name,
      kind: "string",
      prompt: positional.prompt,
      required: positional.required,
      ...(positional.validate === undefined
        ? {}
        : { validate: positional.validate }),
    });

    if (answer === CANCELLED) {
      return "cancelled";
    }

    state.positional = answer === "" ? undefined : answer;
  }

  for (const field of missing) {
    /**
     * Sequential on purpose. `Promise.all` would draw every prompt at once, over
     * the top of each other, into one terminal.
     */
    // biome-ignore lint/performance/noAwaitInLoops: a person answers one question at a time
    const answer = await ask(field);

    if (answer === CANCELLED) {
      return "cancelled";
    }

    // An optional field answered with nothing stays absent rather than becoming
    // an empty string the API would have to reject.
    if (answer !== "" && answer !== undefined) {
      state.values[field.flag] = answer;
    }
  }

  return "ok";
}

export async function resolve(
  command: Command,
  parsed: ParsedArguments,
  options: { readonly interactive: boolean }
): Promise<Resolution> {
  const miscounted = countPositionals(command, parsed.positionals);

  if (miscounted !== null) {
    return { kind: "invalid", message: miscounted };
  }

  const read = readFields(command, parsed.values, options.interactive);

  if (read.error !== undefined) {
    return { kind: "invalid", message: read.error };
  }

  const positional = parsed.positionals[0]?.trim();
  const complaint =
    positional === undefined
      ? undefined
      : command.positional?.validate?.(positional);

  if (complaint !== undefined) {
    return { kind: "invalid", message: complaint };
  }

  const state = { positional, values: read.values };

  if (!options.interactive) {
    return refuseOrAccept(command, state, read.missing);
  }

  const asked = await askFor(command, state, read.missing);

  return asked === "cancelled"
    ? { kind: "cancelled" }
    : { input: inputFrom(state.values, state.positional), kind: "ok" };
}

/**
 * With nobody to ask, name everything missing at once and stop.
 *
 * All of it in one message rather than the first one: fixing a flag and
 * rerunning to discover the next is a worse loop than being told both.
 */
function refuseOrAccept(
  command: Command,
  state: {
    positional: string | undefined;
    values: Record<string, FieldValue>;
  },
  missing: readonly Field[]
): Resolution {
  const wanted = [
    ...(state.positional === undefined && command.positional?.required === true
      ? [`<${command.positional.name}>`]
      : []),
    ...missing
      .filter((field) => field.required)
      .map((field) => `--${field.flag}`),
  ];

  if (wanted.length === 0) {
    return { input: inputFrom(state.values, state.positional), kind: "ok" };
  }

  return {
    kind: "missing",
    message: `${commandName(command)} needs ${listed(wanted)}.\nPass ${wanted.length === 1 ? "it" : "them"}, or run in a terminal without --json for the guided flow.`,
  };
}
