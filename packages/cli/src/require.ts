import { CHECK_KINDS, type CheckKind } from "@propgate/dns";

export interface Requirement {
  readonly caaIssuer?: string;
  readonly check: CheckKind;
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly label?: string;
  readonly requiredPerDomain?: readonly string[];
  readonly selector?: string;
  readonly target?: string;
  readonly token?: string;
}

const STRING_FIELDS = [
  "caaIssuer",
  "expectedPublicKey",
  "include",
  "label",
  "selector",
  "target",
  "token",
] as const;

const BOOLEAN_FIELDS = ["expectsMail"] as const;

const LIST_FIELDS = ["requiredPerDomain"] as const;

type StringField = (typeof STRING_FIELDS)[number];
type BooleanField = (typeof BOOLEAN_FIELDS)[number];
type ListField = (typeof LIST_FIELDS)[number];

function isStringField(name: string): name is StringField {
  return (STRING_FIELDS as readonly string[]).includes(name);
}

function isBooleanField(name: string): name is BooleanField {
  return (BOOLEAN_FIELDS as readonly string[]).includes(name);
}

function isListField(name: string): name is ListField {
  return (LIST_FIELDS as readonly string[]).includes(name);
}

const KNOWN_FIELDS = [...STRING_FIELDS, ...BOOLEAN_FIELDS, ...LIST_FIELDS]
  .sort()
  .join(", ");

function head(value: string): [string, string, string | undefined] {
  const first = value.indexOf(":");

  if (first === -1) {
    return [value, "", undefined];
  }

  const second = value.indexOf(":", first + 1);

  if (second === -1) {
    return [value.slice(0, first), value.slice(first + 1), undefined];
  }

  return [
    value.slice(0, first),
    value.slice(first + 1, second),
    value.slice(second + 1),
  ];
}

interface Assignments {
  readonly lists: Partial<Record<ListField, string[]>>;
  readonly scalars: Partial<Record<BooleanField | StringField, string>>;
}

function assignments(rest: string): Assignments | string {
  const scalars: Partial<Record<BooleanField | StringField, string>> = {};
  const lists: Partial<Record<ListField, string[]>> = {};

  for (const pair of rest.split(",")) {
    const trimmed = pair.trim();

    if (trimmed === "") {
      continue;
    }

    const split = trimmed.indexOf("=");

    if (split === -1) {
      return `"${trimmed}" is not field=value`;
    }

    const name = trimmed.slice(0, split).trim();
    const value = trimmed.slice(split + 1).trim();

    if (!(isStringField(name) || isBooleanField(name) || isListField(name))) {
      return `unknown requirement field "${name}"; known fields are ${KNOWN_FIELDS}`;
    }

    if (value === "") {
      return `${name} needs a value`;
    }

    if (isListField(name)) {
      const seen = lists[name] ?? [];

      if (seen.includes(value)) {
        return `${name}=${value} was given twice`;
      }

      seen.push(value);
      lists[name] = seen;
      continue;
    }

    scalars[name] = value;
  }

  return { lists, scalars };
}

export function parseRequirement(value: string): Requirement | string {
  const [key, check, rest] = head(value.trim());
  const trimmedKey = key.trim();

  if (trimmedKey === "") {
    return `"${value}" needs a key: <key>:<check>[:field=value]`;
  }

  const kind = check.trim();

  if (kind === "") {
    return `"${trimmedKey}" needs a check: one of ${CHECK_KINDS.join(", ")}`;
  }

  if (!CHECK_KINDS.includes(kind as CheckKind)) {
    return `unknown check "${kind}"; one of ${CHECK_KINDS.join(", ")}`;
  }

  const parsed =
    rest === undefined ? { lists: {}, scalars: {} } : assignments(rest);

  if (typeof parsed === "string") {
    return `${trimmedKey}: ${parsed}`;
  }

  const { lists, scalars } = parsed;

  const strings: Partial<Record<StringField, string>> = {};

  for (const field of STRING_FIELDS) {
    const assigned = scalars[field];

    if (assigned !== undefined) {
      strings[field] = assigned;
    }
  }

  const requirement: Requirement = {
    check: kind as CheckKind,
    key: trimmedKey,
    ...strings,
    ...(lists.requiredPerDomain === undefined
      ? {}
      : { requiredPerDomain: lists.requiredPerDomain }),
    ...(scalars.expectsMail === undefined
      ? {}
      : { expectsMail: scalars.expectsMail !== "false" }),
  };

  return checkShape(requirement);
}

function defers(requirement: Requirement, field: string): boolean {
  return requirement.requiredPerDomain?.includes(field) ?? false;
}

function checkShape(requirement: Requirement): Requirement | string {
  if (
    requirement.check === "dkim" &&
    requirement.selector === undefined &&
    !defers(requirement, "selector")
  ) {
    return `${requirement.key}: dkim needs a selector, as ${requirement.key}:dkim:selector=<name>, or requiredPerDomain=selector`;
  }

  if (
    requirement.check === "caa" &&
    requirement.caaIssuer === undefined &&
    !defers(requirement, "caaIssuer")
  ) {
    return `${requirement.key}: caa needs an issuer, as ${requirement.key}:caa:caaIssuer=<ca>, or requiredPerDomain=caaIssuer`;
  }

  return requirement;
}

export function parseRequirements(
  values: readonly string[]
): readonly Requirement[] | string {
  const requirements: Requirement[] = [];

  for (const value of values) {
    const parsed = parseRequirement(value);

    if (typeof parsed === "string") {
      return parsed;
    }

    requirements.push(parsed);
  }

  return requirements;
}
