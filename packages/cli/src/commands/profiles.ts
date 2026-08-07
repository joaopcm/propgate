import { readFileSync } from "node:fs";
import { CHECK_KINDS, type CheckKind } from "@propgate/dns";
import { apiRequest } from "../client";
import type { Command, Input } from "../command";
import { EXIT_CANCELLED } from "../exit";
import { type Context, json, out, reportApiError, usage } from "../output";
import { askConfirm, askSelect, askText, CANCELLED } from "../prompt";
import { parseRequirements, type Requirement } from "../require";
import { table } from "../table";

/** `POST /v1/profiles` and `GET /v1/profiles/:key`. */

interface ProfileVersion {
  readonly id: string;
  readonly key: string;
  readonly requirements: readonly Requirement[];
  readonly version: number;
}

interface Definition {
  readonly key: string;
  readonly requirements: readonly Requirement[];
}

/** `-` reads stdin, so a profile can be generated and piped in one line. */
function readDefinition(path: string): Definition | string {
  let raw: string;

  try {
    raw = readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (cause) {
    return `could not read ${path === "-" ? "stdin" : path}: ${(cause as Error).message}`;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${path === "-" ? "stdin" : path} is not valid JSON`;
  }

  const candidate = parsed as Partial<Definition>;

  if (typeof candidate.key !== "string" || candidate.key === "") {
    return `${path} needs a "key"`;
  }

  if (!Array.isArray(candidate.requirements)) {
    return `${path} needs a "requirements" array`;
  }

  return { key: candidate.key, requirements: candidate.requirements };
}

function describe(requirement: Requirement): string {
  const detail = [
    requirement.selector === undefined
      ? null
      : `selector=${requirement.selector}`,
    requirement.include === undefined ? null : `include=${requirement.include}`,
    requirement.caaIssuer === undefined
      ? null
      : `caaIssuer=${requirement.caaIssuer}`,
    // Rendered for the same reason `requiredPerDomain` is: a profile whose spf
    // sits on a bounce host and one whose spf sits on the apex are different
    // contracts, and nothing else on this line tells them apart.
    requirement.label === undefined ? null : `label=${requirement.label}`,
    requirement.target === undefined ? null : `target=${requirement.target}`,
    requirement.token === undefined ? null : "token set",
    requirement.expectsMail === undefined
      ? null
      : `expectsMail=${requirement.expectsMail}`,
    requirement.expectedPublicKey === undefined
      ? null
      : "expectedPublicKey set",
    // Rendered rather than omitted: it is the difference between a profile that
    // works on its own and one every domain must supply a value for, and the
    // registration that fails without it says nothing about which profile asked.
    requirement.requiredPerDomain === undefined ||
    requirement.requiredPerDomain.length === 0
      ? null
      : `per domain: ${[...requirement.requiredPerDomain].sort().join(" ")}`,
  ].filter((entry): entry is string => entry !== null);

  return detail.join(", ");
}

function show(profile: ProfileVersion): void {
  out(`${profile.key}  version ${profile.version}`);
  out("");

  for (const line of table(
    profile.requirements.map((requirement) => [
      requirement.key,
      requirement.check,
      describe(requirement),
    ])
  )) {
    out(`  ${line}`);
  }
}

/**
 * The guided path: one requirement at a time, asking only the fields that
 * requirement's check actually has.
 *
 * The two conditional questions — a selector for `dkim`, an issuer for `caa` —
 * are the same two rules `parseRequirement` enforces, which is why they are worth
 * knowing on this side. Everything else about a valid profile is the server's to
 * say.
 */
async function askOne(first: boolean): Promise<Requirement | typeof CANCELLED> {
  const key = await askText({
    describe: "",
    flag: "requirement key",
    kind: "string",
    placeholder: first ? "root" : "mail",
    prompt: "Name this requirement",
    required: true,
  });

  if (key === CANCELLED) {
    return CANCELLED;
  }

  const check = await askSelect({
    choices: CHECK_KINDS.map((kind) => ({ value: kind })),
    describe: "",
    flag: "check",
    kind: "select",
    prompt: `What should "${key}" check?`,
    required: true,
  });

  return check === CANCELLED
    ? CANCELLED
    : await fieldsFor(check as CheckKind, key);
}

async function build(): Promise<readonly Requirement[] | typeof CANCELLED> {
  const requirements: Requirement[] = [];

  for (;;) {
    /**
     * Sequential, and not a candidate for `Promise.all`: the next question
     * depends on the last answer, and a person answers one at a time.
     */
    // biome-ignore lint/performance/noAwaitInLoops: one requirement at a time, by definition
    const answered = await askOne(requirements.length === 0);

    if (answered === CANCELLED) {
      return CANCELLED;
    }

    requirements.push(answered);

    const again = await askConfirm("Add another requirement?", false);

    if (again === CANCELLED) {
      return CANCELLED;
    }

    if (!again) {
      return requirements;
    }
  }
}

async function optionalText(
  prompt: string,
  placeholder: string
): Promise<string | undefined | typeof CANCELLED> {
  const answer = await askText({
    describe: "",
    flag: "value",
    kind: "string",
    placeholder,
    prompt: `${prompt} (enter to skip)`,
    required: false,
  });

  if (answer === CANCELLED) {
    return CANCELLED;
  }

  return answer === "" ? undefined : answer;
}

async function dkimFields(
  key: string
): Promise<Requirement | typeof CANCELLED> {
  const selector = await askText({
    describe: "",
    flag: "selector",
    kind: "string",
    placeholder: "resend",
    prompt: "Which DKIM selector?",
    required: true,
  });

  if (selector === CANCELLED) {
    return CANCELLED;
  }

  /**
   * Asked before the key itself, because the answer decides whether there is a
   * key to ask for.
   *
   * Defaulting to yes: a DKIM key is issued per domain, so a profile holding one
   * literal key is a profile that works for exactly one domain. Someone reaching
   * this prompt with ten thousand domains needs the default to be the shape that
   * scales, and the other answer is one keypress away.
   */
  const perDomain = await askConfirm(
    "Is the public key different for every domain?",
    true
  );

  if (perDomain === CANCELLED) {
    return CANCELLED;
  }

  if (perDomain) {
    return {
      check: "dkim",
      key,
      requiredPerDomain: ["expectedPublicKey"],
      selector,
    };
  }

  const expectedPublicKey = await optionalText(
    "The public key you issued",
    "MIGfMA0GCSq..."
  );

  if (expectedPublicKey === CANCELLED) {
    return CANCELLED;
  }

  return {
    check: "dkim",
    key,
    selector,
    ...(expectedPublicKey === undefined ? {} : { expectedPublicKey }),
  };
}

async function caaFields(key: string): Promise<Requirement | typeof CANCELLED> {
  const caaIssuer = await askText({
    describe: "",
    flag: "caaIssuer",
    kind: "string",
    placeholder: "letsencrypt.org",
    prompt: "Which certificate authority must be authorised?",
    required: true,
  });

  return caaIssuer === CANCELLED ? CANCELLED : { caaIssuer, check: "caa", key };
}

/**
 * The label question both mail checks ask.
 *
 * Optional, and the placeholder is `send` because that is what the answer almost
 * always is: a platform's return-path host. Skipping it means the apex, which is
 * the other half of the same profile rather than a lesser answer.
 */
async function labelField(
  prompt: string
): Promise<string | undefined | typeof CANCELLED> {
  return await optionalText(prompt, "send");
}

async function spfFields(key: string): Promise<Requirement | typeof CANCELLED> {
  const include = await optionalText(
    "An include: token that must authorise this domain",
    "_spf.resend.com"
  );

  if (include === CANCELLED) {
    return CANCELLED;
  }

  const label = await labelField(
    "Which label publishes it? Enter for the apex"
  );

  return label === CANCELLED
    ? CANCELLED
    : {
        check: "spf",
        key,
        ...(include === undefined ? {} : { include }),
        ...(label === undefined ? {} : { label }),
      };
}

async function mxFields(key: string): Promise<Requirement | typeof CANCELLED> {
  /**
   * Three answers, not a yes/no.
   *
   * `expectsMail` is tri-state, and a skipped confirm would become `false` — an
   * assertion that the domain receives no mail, which is a different claim from
   * making none. So "do not say" has to be an option someone can pick.
   */
  const answer = await askSelect({
    choices: [
      { hint: "Make no claim either way.", value: "unstated" },
      { hint: "Undeliverable mail is a fault.", value: "yes" },
      { hint: "A null MX is correct.", value: "no" },
    ],
    describe: "",
    flag: "expectsMail",
    kind: "select",
    prompt: "Should this name receive mail?",
    required: true,
  });

  if (answer === CANCELLED) {
    return CANCELLED;
  }

  const label = await labelField("Which label? Enter for the apex");

  if (label === CANCELLED) {
    return CANCELLED;
  }

  return {
    check: "mx",
    key,
    ...(answer === "unstated" ? {} : { expectsMail: answer === "yes" }),
    ...(label === undefined ? {} : { label }),
  };
}

/** Only the fields this check actually has. `delegation` and `dmarc` have none. */
async function fieldsFor(
  check: CheckKind,
  key: string
): Promise<Requirement | typeof CANCELLED> {
  if (check === "dkim") {
    return await dkimFields(key);
  }

  if (check === "caa") {
    return await caaFields(key);
  }

  if (check === "spf") {
    return await spfFields(key);
  }

  return check === "mx" ? await mxFields(key) : { check, key };
}

/**
 * Three ways in, and they do not mix.
 *
 * `--file` carries the key as well, so `--key … --file …` would leave a reader
 * guessing which one wins. Returning a string is a complaint, `CANCELLED` is
 * Ctrl-C, and a `Definition` is something to POST.
 */
async function definitionFrom(
  input: Input,
  interactive: boolean
): Promise<Definition | string | typeof CANCELLED> {
  const file = input.text("file");
  const given = input.list("require");
  const key = input.text("key");

  if (file !== undefined) {
    return given.length > 0 || key !== undefined
      ? "--file carries the whole profile; --key and --require do not"
      : readDefinition(file);
  }

  if (key === undefined) {
    return "profiles create needs --key.\nPass it, or run in a terminal without --json for the guided flow.";
  }

  if (given.length > 0) {
    const parsed = parseRequirements(given);

    return typeof parsed === "string" ? parsed : { key, requirements: parsed };
  }

  if (!interactive) {
    return "profiles create needs --require or --file.\nEach --require is <key>:<check>[:field=value], e.g. 'mail:spf:include=_spf.resend.com'.";
  }

  const built = await build();

  return built === CANCELLED ? CANCELLED : { key, requirements: built };
}

async function create(input: Input, context: Context): Promise<number> {
  const definition = await definitionFrom(input, context.interactive);

  if (definition === CANCELLED) {
    return EXIT_CANCELLED;
  }

  if (typeof definition === "string") {
    return usage(definition);
  }

  const result = await apiRequest<ProfileVersion>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: definition,
    method: "POST",
    path: "/v1/profiles",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not create the profile"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  const created = result.body.data;

  out(
    created.version === 1
      ? `Created ${created.key}.`
      : `Wrote ${created.key} version ${created.version}. Domains keep the version they were registered against.`
  );
  out("");
  show(created);

  return 0;
}

async function get(input: Input, context: Context): Promise<number> {
  const result = await apiRequest<ProfileVersion>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/profiles/${encodeURIComponent(input.needPositional())}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not read the profile"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  show(result.body.data);

  return 0;
}

export const profilesCommands: readonly Command[] = [
  {
    authenticated: true,
    examples: [
      "propgate profiles create --key sending \\",
      "    --require 'root:delegation' \\",
      "    --require 'mail:spf:include=_spf.resend.com' \\",
      "    --require 'k1:dkim:selector=resend'",
      "propgate profiles create --file profile.json",
      "cat profile.json | propgate profiles create --file -",
    ],
    /**
     * `--key` rather than a positional, unlike every other create in this CLI.
     *
     * `--file` carries the key as well, and `profiles create sending --file x.json`
     * would leave a reader guessing which one wins. A profile is one compound
     * object; it arrives whole or it is built up out of flags.
     */
    fields: [
      {
        describe: "The profile key. Re-using one writes a new version.",
        flag: "key",
        kind: "string",
        placeholder: "key",
        prompt: "What should this profile be called?",
        /**
         * Optional to `resolve` but always asked for in a terminal.
         *
         * It cannot be `required`, because `--file` carries the key itself and a
         * required field would make `--file` alone impossible. Marking it here
         * gets the question asked anyway, and `definitionFrom` produces the
         * error for the scripted case.
         */
        promptWhenOptional: true,
        required: false,
      },
      {
        describe:
          "A requirement, as <key>:<check>[:field=value,...]. Repeatable, up to 20.",
        flag: "require",
        kind: "string",
        placeholder: "key:check:field=value",
        // Never prompted for through the generic path: the guided flow asks one
        // question per field of one requirement at a time, which the micro-syntax
        // exists to avoid making anyone type.
        prompt: "A requirement, as key:check:field=value",
        repeatable: true,
        required: false,
      },
      {
        describe:
          'The whole profile as JSON: {"key":…,"requirements":[…]}. `-` reads stdin.',
        flag: "file",
        kind: "string",
        placeholder: "path",
        prompt: "Which file?",
        required: false,
      },
    ],
    networked: true,
    path: ["profiles", "create"],
    run: create,
    summary:
      "Create a profile version. Editing a profile writes a new version; it never changes an existing one.",
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["profiles", "get"],
    positional: {
      describe: "The profile key.",
      name: "key",
      prompt: "Which profile?",
      required: true,
    },
    run: get,
    summary: "The current version of a profile.",
  },
];
