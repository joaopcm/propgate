import type { Context } from "./output";

/**
 * What a command is.
 *
 * The point of this file is one sentence: **a field is declared once and drives
 * both the flag and the prompt.** `--profile <key>` and "Which profile should
 * this use?" are the same `Field`, so the scripted path and the guided path
 * cannot describe different arguments. Adding an endpoint is adding a `Command`
 * literal; nothing else has to be kept in step by hand.
 */

export type FieldKind = "boolean" | "multiselect" | "select" | "string";

export interface Choice {
  readonly hint?: string;
  readonly label?: string;
  readonly value: string;
}

export interface Field {
  /** For `select` and `multiselect`. */
  readonly choices?: readonly Choice[];
  /** The usage line. */
  readonly describe: string;
  /** The long flag, without dashes. Also the key the value is read back by. */
  readonly flag: string;
  readonly kind: FieldKind;
  readonly placeholder?: string;
  /** The question, when there is nobody to read the usage line. */
  readonly prompt: string;
  /**
   * Asked for even when nothing is missing.
   *
   * Some fields are optional to the API but worth offering in the guided flow —
   * `--external-id` is the example. Off by default: a prompt for something nobody
   * needs is a prompt people learn to skip.
   */
  readonly promptWhenOptional?: boolean;
  /** May be given more than once. `string` and `multiselect` only. */
  readonly repeatable?: boolean;
  readonly required: boolean;
  /** Returns a message when the value is wrong, `undefined` when it is fine. */
  readonly validate?: (value: string) => string | undefined;
}

export interface Positional {
  readonly describe: string;
  /** Shown in usage as `<name>`. */
  readonly name: string;
  readonly prompt: string;
  readonly required: boolean;
  readonly validate?: (value: string) => string | undefined;
}

export type FieldValue = boolean | string | readonly string[] | undefined;

/**
 * The resolved arguments, read by name.
 *
 * Accessors rather than a typed record because the alternative is a generic
 * parameter on `Command` that every one of the twenty-three literals would have
 * to spell out. The names say which shape they return, and `resolve` has already
 * guaranteed the required ones are present.
 */
export interface Input {
  readonly bool: (flag: string) => boolean;
  readonly list: (flag: string) => readonly string[];
  /** A required field. Present by construction — `resolve` refused otherwise. */
  readonly need: (flag: string) => string;
  /** A required positional. Present by construction. */
  readonly needPositional: () => string;
  readonly positional: string | undefined;
  readonly text: (flag: string) => string | undefined;
}

export interface Command {
  /** Sends a bearer token. False for `check`, `signup` and `confirm`. */
  readonly authenticated: boolean;
  readonly examples?: readonly string[];
  readonly fields: readonly Field[];
  /** Can talk to the API, so it accepts `--api-url`. */
  readonly networked: boolean;
  /** `["domains", "add"]`. The words before the first flag. */
  readonly path: readonly string[];
  readonly positional?: Positional;
  readonly run: (input: Input, context: Context) => Promise<number>;
  readonly summary: string;
}

export function commandName(command: Command): string {
  return command.path.join(" ");
}

/**
 * A declared-but-absent required value is a bug in a `Command` literal, not
 * something a user can cause: `resolve` returns `missing` before `run` is
 * reached. Throwing names the field, which is what the next person needs.
 */
function absent(flag: string): never {
  throw new Error(
    `internal: "${flag}" was declared required but never resolved`
  );
}

export function inputFrom(
  values: Readonly<Record<string, FieldValue>>,
  positional: string | undefined
): Input {
  const text = (flag: string): string | undefined => {
    const value = values[flag];

    return typeof value === "string" ? value : undefined;
  };

  return {
    bool: (flag) => values[flag] === true,
    list: (flag) => {
      const value = values[flag];

      if (Array.isArray(value)) {
        return value as readonly string[];
      }

      return typeof value === "string" ? [value] : [];
    },
    need: (flag) => text(flag) ?? absent(flag),
    needPositional: () => positional ?? absent("<positional>"),
    positional,
    text,
  };
}
