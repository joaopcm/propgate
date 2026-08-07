import { CHECK_KINDS, type CheckKind } from "@propgate/dns";

/**
 * `--require '<key>:<check>[:field=value,field=value]'`
 *
 * A profile is an array of up to twenty objects with six possible fields each,
 * which no flag shape expresses well. This one at least expresses it *honestly*:
 * the field names are the API's own body field names, verbatim and unaliased, so
 * a 422 from the server names the same word the caller typed. Renaming `include`
 * to `--spf-include` here would mean the error and the input never quite match.
 *
 *   root:delegation
 *   mail:spf:include=_spf.resend.com
 *   k1:dkim:selector=resend
 *   ca:caa:caaIssuer=letsencrypt.org
 *   inbox:mx:expectsMail=true
 */

export interface Requirement {
  readonly caaIssuer?: string;
  readonly check: CheckKind;
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly selector?: string;
}

/** Exactly the optional fields of `requirementSchema` in the API. */
const STRING_FIELDS = [
  "caaIssuer",
  "expectedPublicKey",
  "include",
  "selector",
] as const;

const BOOLEAN_FIELDS = ["expectsMail"] as const;

type StringField = (typeof STRING_FIELDS)[number];
type BooleanField = (typeof BOOLEAN_FIELDS)[number];

function isStringField(name: string): name is StringField {
  return (STRING_FIELDS as readonly string[]).includes(name);
}

function isBooleanField(name: string): name is BooleanField {
  return (BOOLEAN_FIELDS as readonly string[]).includes(name);
}

const KNOWN_FIELDS = [...STRING_FIELDS, ...BOOLEAN_FIELDS].sort().join(", ");

/**
 * Split into at most three parts on `:`.
 *
 * The third part keeps any colons it contains: a DKIM public key or an SPF token
 * is a value, not more structure, and `split(":")` with no limit would shred one.
 */
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

/** Partial: every field is optional, which is what makes the checks below real. */
type Assignments = Partial<Record<BooleanField | StringField, string>>;

function assignments(rest: string): Assignments | string {
  const fields: Assignments = {};

  for (const pair of rest.split(",")) {
    const trimmed = pair.trim();

    if (trimmed === "") {
      continue;
    }

    // First `=` only. Base64 DKIM keys end in padding, and a key that lost its
    // `==` is a key that silently fails to match.
    const split = trimmed.indexOf("=");

    if (split === -1) {
      return `"${trimmed}" is not field=value`;
    }

    const name = trimmed.slice(0, split).trim();
    const value = trimmed.slice(split + 1).trim();

    if (!(isStringField(name) || isBooleanField(name))) {
      return `unknown requirement field "${name}"; known fields are ${KNOWN_FIELDS}`;
    }

    if (value === "") {
      return `${name} needs a value`;
    }

    fields[name] = value;
  }

  return fields;
}

/**
 * Parse one `--require`, or say why not.
 *
 * `Requirement | string` rather than a throw, which is how `parseResolver` in
 * `args.ts` reports the same class of problem.
 */
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

  const fields = rest === undefined ? {} : assignments(rest);

  if (typeof fields === "string") {
    return `${trimmedKey}: ${fields}`;
  }

  const requirement: Requirement = {
    check: kind as CheckKind,
    key: trimmedKey,
    ...(fields.caaIssuer === undefined ? {} : { caaIssuer: fields.caaIssuer }),
    ...(fields.expectedPublicKey === undefined
      ? {}
      : { expectedPublicKey: fields.expectedPublicKey }),
    ...(fields.include === undefined ? {} : { include: fields.include }),
    ...(fields.selector === undefined ? {} : { selector: fields.selector }),
    ...(fields.expectsMail === undefined
      ? {}
      : { expectsMail: fields.expectsMail !== "false" }),
  };

  return checkShape(requirement);
}

/**
 * The two rules we enforce here, and the many we deliberately do not.
 *
 * These two decide which question the guided flow asks next, so knowing them on
 * this side is not duplication — it is the same fact, needed here anyway. Every
 * other rule in `rejectDefinition` (unique keys, at most twenty, only DKIM may
 * repeat a kind) stays on the server, because a second implementation of a rule
 * is a second thing that can disagree, and the API's 422 already says it better.
 */
function checkShape(requirement: Requirement): Requirement | string {
  if (requirement.check === "dkim" && requirement.selector === undefined) {
    return `${requirement.key}: dkim needs a selector, as ${requirement.key}:dkim:selector=<name>`;
  }

  if (requirement.check === "caa" && requirement.caaIssuer === undefined) {
    return `${requirement.key}: caa needs an issuer, as ${requirement.key}:caa:caaIssuer=<ca>`;
  }

  return requirement;
}

/** Every `--require`, or the first complaint. */
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
