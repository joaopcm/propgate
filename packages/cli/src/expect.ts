export type Expectations = Record<string, Record<string, string>>;

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

export function anyExpectations(expectations: Expectations): boolean {
  return Object.keys(expectations).length > 0;
}
