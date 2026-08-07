import type { Choice, Field } from "./command";

/**
 * The only file that knows `@clack/prompts` exists.
 *
 * Two reasons it is quarantined here. Commands stay testable without a TTY,
 * because they never call a prompt directly — `resolve` does, and `resolve` is
 * given the decision as a boolean. And the import is **dynamic**, so
 * `propgate check example.com` never loads it: that command is a local
 * diagnostic that resolves DNS and touches nothing else, and it should not pay
 * for a dependency it cannot reach.
 */

/** Ctrl-C. Distinct from every valid answer, including `false` and `""`. */
export const CANCELLED: unique symbol = Symbol("cancelled");

export type Answer<T> = T | typeof CANCELLED;

async function clack() {
  return await import("@clack/prompts");
}

function options(choices: readonly Choice[]) {
  return choices.map((choice) => ({
    ...(choice.hint === undefined ? {} : { hint: choice.hint }),
    ...(choice.label === undefined ? {} : { label: choice.label }),
    value: choice.value,
  }));
}

/**
 * An empty answer is not an answer for a required field.
 *
 * clack returns `""` when someone presses enter on an empty line, and without
 * this the CLI would happily POST a blank name and let the API's 422 explain it.
 */
function validator(
  field: Field
): (value: string | undefined) => string | undefined {
  return (value: string | undefined) => {
    const trimmed = (value ?? "").trim();

    if (trimmed === "") {
      return field.required ? `${field.flag} cannot be empty` : undefined;
    }

    return field.validate?.(trimmed);
  };
}

export async function askText(field: Field): Promise<Answer<string>> {
  const { isCancel, text } = await clack();
  const answer = await text({
    message: field.prompt,
    ...(field.placeholder === undefined
      ? {}
      : { placeholder: field.placeholder }),
    validate: validator(field),
  });

  return isCancel(answer) ? CANCELLED : String(answer).trim();
}

export async function askSelect(field: Field): Promise<Answer<string>> {
  const { isCancel, select } = await clack();
  const answer = await select<string>({
    message: field.prompt,
    options: options(field.choices ?? []),
  });

  return isCancel(answer) ? CANCELLED : answer;
}

export async function askMultiselect(
  field: Field
): Promise<Answer<readonly string[]>> {
  const { isCancel, multiselect } = await clack();
  const answer = await multiselect<string>({
    message: field.prompt,
    options: options(field.choices ?? []),
    required: field.required,
  });

  return isCancel(answer) ? CANCELLED : answer;
}

export async function askConfirm(
  message: string,
  initialValue = true
): Promise<Answer<boolean>> {
  const { confirm, isCancel } = await clack();
  const answer = await confirm({ initialValue, message });

  return isCancel(answer) ? CANCELLED : answer;
}

export async function intro(title: string): Promise<void> {
  const clacked = await clack();

  clacked.intro(title);
}

export async function outro(message: string): Promise<void> {
  const clacked = await clack();

  clacked.outro(message);
}

export async function note(body: string, title?: string): Promise<void> {
  const clacked = await clack();

  clacked.note(body, title);
}

export async function cancelled(message = "Cancelled."): Promise<void> {
  const clacked = await clack();

  clacked.cancel(message);
}
