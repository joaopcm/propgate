/**
 * `--expect '<requirement>.<field>=<value>'`
 *
 * The values a profile requires per domain. A profile says *there must be a DKIM
 * key at this selector*; each domain says *and here is the one we issued it*.
 * Without this flag the CLI cannot register a domain at all against such a
 * profile — the API refuses it with a 422 naming the path it wanted.
 *
 * The field names are the API's own, verbatim, for the same reason `--require`
 * uses them: a 422 then names the word the caller typed.
 *
 *   dkim.expectedPublicKey=MIGfMA0GCSq...
 *   caa.caaIssuer=letsencrypt.org
 */

export type Expectations = Record<string, Record<string, string>>;

/**
 * Split on the *first* `=` and the *last* `.`, neither of which is arbitrary.
 *
 * A base64 DKIM key ends in `=` or `==`, so splitting on every equals sign would
 * truncate the one value this flag exists for. And no field name contains a dot
 * while a requirement key may, so the last dot is the only unambiguous boundary.
 *
 * A repeated `<requirement>.<field>` is an error rather than a last-one-wins: a
 * typo and a genuine second value are indistinguishable here, and silently
 * dropping one of two keys is how a domain ends up verified against the wrong one.
 *
 * `Expectations | string` rather than a throw, matching `parseRequirement`.
 */
export function parseExpectations(
  values: readonly string[]
): Expectations | string {
  const expectations: Expectations = {};

  for (const entry of values) {
    const trimmed = entry.trim();
    const equals = trimmed.indexOf("=");

    if (equals < 1) {
      return `"${trimmed}" is not <requirement>.<field>=<value>`;
    }

    const path = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim();
    const dot = path.lastIndexOf(".");

    if (dot < 1 || dot === path.length - 1) {
      return `"${trimmed}" needs a requirement and a field, as <requirement>.<field>=<value>`;
    }

    if (value === "") {
      return `${path} needs a value`;
    }

    const requirementKey = path.slice(0, dot);
    const field = path.slice(dot + 1);
    const fields = expectations[requirementKey] ?? {};

    if (fields[field] !== undefined) {
      return `${path} was given twice`;
    }

    fields[field] = value;
    expectations[requirementKey] = fields;
  }

  return expectations;
}

/** Whether anything was supplied, so a body can omit the key entirely. */
export function anyExpectations(expectations: Expectations): boolean {
  return Object.keys(expectations).length > 0;
}
