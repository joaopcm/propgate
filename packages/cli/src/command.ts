import type { Context } from "./output";

export type FieldKind = "boolean" | "multiselect" | "select" | "string";

export interface Choice {
  readonly hint?: string;
  readonly label?: string;
  readonly value: string;
}

export interface Field {
  readonly choices?: readonly Choice[];
  readonly describe: string;
  readonly flag: string;
  readonly kind: FieldKind;
  readonly placeholder?: string;
  readonly prompt: string;
  readonly promptWhenOptional?: boolean;
  readonly repeatable?: boolean;
  readonly required: boolean;
  readonly validate?: (value: string) => string | undefined;
}

export interface Positional {
  readonly describe: string;
  readonly name: string;
  readonly prompt: string;
  readonly required: boolean;
  readonly validate?: (value: string) => string | undefined;
}

export type FieldValue = boolean | string | readonly string[] | undefined;

export interface Input {
  readonly bool: (flag: string) => boolean;
  readonly list: (flag: string) => readonly string[];
  readonly need: (flag: string) => string;
  readonly needPositional: () => string;
  readonly positional: string | undefined;
  readonly text: (flag: string) => string | undefined;
}

export interface Command {
  readonly authenticated: boolean;
  readonly examples?: readonly string[];
  readonly fields: readonly Field[];
  readonly networked: boolean;
  readonly path: readonly string[];
  readonly positional?: Positional;
  readonly run: (input: Input, context: Context) => Promise<number>;
  readonly summary: string;
}

export function commandName(command: Command): string {
  return command.path.join(" ");
}

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
