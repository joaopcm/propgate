import { apiRequest, paginate, queryString } from "../client";
import type { Command, Input } from "../command";
import { anyExpectations, parseExpectations } from "../expect";
import { type Context, json, out, reportApiError, usage } from "../output";
import { table, when } from "../table";
import {
  allField,
  cursorField,
  DOMAIN_STATES,
  limitField,
  positiveInteger,
  stateField,
} from "./shared";

/** Everything under `/v1/domains`. */

const MAX_PAGE_LIMIT = 200;

interface Requirement {
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: string;
}

interface DomainRow {
  readonly createdAt: string;
  readonly externalId: string | null;
  readonly id: string;
  readonly lastCheckedAt: string | null;
  readonly name: string;
  readonly requirements: readonly Requirement[] | null;
  readonly requirementsMet: number | null;
  readonly requirementsTotal: number | null;
  readonly state: string;
  readonly verdict: string | null;
}

function met(domain: DomainRow): string {
  return domain.requirementsTotal === null
    ? "not checked"
    : `${domain.requirementsMet}/${domain.requirementsTotal}`;
}

function rows(domains: readonly DomainRow[]): string[] {
  return table(
    domains.map((domain) => [
      domain.state,
      domain.name,
      met(domain),
      `checked ${when(domain.lastCheckedAt)}`,
    ])
  );
}

/** The single-domain view, which is the only place per-requirement detail fits. */
function describe(domain: DomainRow): void {
  out(`${domain.name}  ${domain.state}`);
  out("");

  for (const line of table([
    ["id", domain.id],
    ["external id", domain.externalId ?? "—"],
    ["registered", when(domain.createdAt)],
    ["last checked", when(domain.lastCheckedAt)],
    ["verdict", domain.verdict ?? "—"],
  ])) {
    out(`  ${line}`);
  }

  if (domain.requirements === null) {
    out("");
    out("Nothing has been checked yet — the sweeper will pick it up.");

    return;
  }

  out("");

  for (const line of table(
    domain.requirements.map((requirement) => [
      requirement.satisfied ? "ok" : " x",
      requirement.key,
      requirement.verdict,
    ])
  )) {
    out(`  ${line}`);
  }
}

async function add(input: Input, context: Context): Promise<number> {
  const externalId = input.text("external-id");
  const expectations = parseExpectations(input.list("expect"));

  if (typeof expectations === "string") {
    return usage(expectations);
  }

  const result = await apiRequest<DomainRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: {
      ...(anyExpectations(expectations) ? { expectations } : {}),
      ...(externalId === undefined ? {} : { externalId }),
      name: input.needPositional(),
      profile: input.need("profile"),
    },
    method: "POST",
    path: "/v1/domains",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not register the domain"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  out(`${result.body.data.name} registered as ${result.body.data.id}.`);
  // Registration does not touch DNS, which is worth saying: otherwise `state:
  // pending` reads as a failure rather than as "nobody has looked yet".
  out("Nothing has been checked yet — the sweeper will pick it up.");

  return 0;
}

async function list(input: Input, context: Context): Promise<number> {
  const state = input.text("state");
  const externalId = input.text("external-id");
  const cursor = input.text("cursor");
  const limit = input.text("limit");

  if (input.bool("all") && cursor !== undefined) {
    return usage(
      "--all walks every page from the start; --cursor says where to start. Pick one."
    );
  }

  if (input.bool("all")) {
    const walked = await paginate<DomainRow>({
      apiKey: context.apiKey,
      apiUrl: context.apiUrl,
      path: "/v1/domains",
      query: { externalId, state },
    });

    if (walked.kind === "failed") {
      return reportApiError(
        walked.failure.status,
        walked.failure.body.error?.message,
        "could not list domains"
      );
    }

    return context.json
      ? json({ data: walked.items, error: null, meta: { nextCursor: null } })
      : report(walked.items);
  }

  const result = await apiRequest<DomainRow[]>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/domains${queryString({ cursor, externalId, limit, state })}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not list domains"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  const code = report(result.body.data);
  const next = result.body.meta?.nextCursor;

  if (typeof next === "string" && next !== "") {
    out("");
    out(`More rows. Continue with --cursor ${next}, or pass --all.`);
  }

  return code;
}

function report(domains: readonly DomainRow[]): number {
  for (const line of rows(domains)) {
    out(line);
  }

  // An empty list is a real answer, and printing nothing looks like a failure.
  if (domains.length === 0) {
    out(
      "No domains yet. Add one with `propgate domains add <domain> --profile <key>`."
    );
  }

  return 0;
}

async function get(input: Input, context: Context): Promise<number> {
  const result = await apiRequest<DomainRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/domains/${encodeURIComponent(input.needPositional())}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not read the domain"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  describe(result.body.data);

  return 0;
}

async function verify(input: Input, context: Context): Promise<number> {
  const result = await apiRequest<DomainRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(input.needPositional())}/checks`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "the check could not be run"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  describe(result.body.data);

  return 0;
}

interface Change {
  readonly current: string | null;
  readonly observedAt: string;
  readonly previous: string | null;
  readonly requirementKey: string;
}

async function timeline(input: Input, context: Context): Promise<number> {
  const result = await apiRequest<Change[]>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/domains/${encodeURIComponent(input.needPositional())}/timeline${queryString(
      { limit: input.text("limit") }
    )}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not read the timeline"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  if (result.body.data.length === 0) {
    // Not the same as "nothing has happened": only actual changes are appended,
    // so a domain checked hourly for a month and never altered has an empty one.
    out("Nothing has changed. Only differences are recorded, not checks.");

    return 0;
  }

  for (const line of table(
    result.body.data.map((change) => [
      when(change.observedAt),
      change.requirementKey,
      `${change.previous ?? "—"} → ${change.current ?? "—"}`,
    ])
  )) {
    out(line);
  }

  return 0;
}

async function remove(input: Input, context: Context): Promise<number> {
  const id = input.needPositional();
  const result = await apiRequest<{ deleted: boolean; id: string }>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    method: "DELETE",
    path: `/v1/domains/${encodeURIComponent(id)}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not delete the domain"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  out(`${id} is no longer tracked.`);

  return 0;
}

async function update(input: Input, context: Context): Promise<number> {
  const profile = input.text("profile");
  const expectations = parseExpectations(input.list("expect"));

  if (typeof expectations === "string") {
    return usage(expectations);
  }

  const supplied = anyExpectations(expectations);

  if (!supplied && profile === undefined) {
    // Sent as-is this is a 422, and saying so here saves the round trip. It is
    // also not a harmless no-op: the call resets the domain and re-verifies it.
    return usage(
      "nothing to change. Pass --expect, --profile, or both."
    );
  }

  const result = await apiRequest<DomainRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: {
      ...(supplied ? { expectations } : {}),
      ...(profile === undefined ? {} : { profile }),
    },
    method: "PATCH",
    path: `/v1/domains/${encodeURIComponent(input.needPositional())}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not update the domain"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  describe(result.body.data);
  out("");
  // The reset is the surprising part, and the reason it is not a regression is
  // worth one line: nothing has looked at the new values yet.
  out(
    "Back to pending, and no webhook was sent — the value we compare changed"
  );
  out("because you changed it. The next check verifies against it.");

  return 0;
}

const profileField = {
  describe: "The profile key this domain must satisfy.",
  flag: "profile",
  kind: "string" as const,
  placeholder: "key",
  prompt: "Which profile should this domain satisfy?",
  required: true,
};

/**
 * One value a profile requires per domain, repeatable.
 *
 * Declared once and shared by `add` and `update`, so the two cannot drift on the
 * spelling of the thing a rotation depends on.
 */
const expectField = {
  describe:
    "A value the profile requires per domain, as <requirement>.<field>=<value>. Repeatable.",
  flag: "expect",
  kind: "string" as const,
  placeholder: "dkim.expectedPublicKey=MIGf...",
  prompt: "A value this profile requires per domain (enter to skip)",
  repeatable: true,
  required: false,
};

const externalIdField = {
  describe:
    "Your own id for this domain. Re-sending it makes the call idempotent.",
  flag: "external-id",
  kind: "string" as const,
  placeholder: "id",
  prompt: "Your own id for this domain, if you have one",
  promptWhenOptional: true,
  required: false,
};

const idPositional = {
  describe: "The domain id from `domains list`.",
  name: "id",
  prompt: "Which domain id?",
  required: true,
};

export const domainsCommands: readonly Command[] = [
  {
    authenticated: true,
    examples: [
      "propgate domains add example.com --profile sending",
      "propgate domains add example.com --profile sending --expect dkim.expectedPublicKey=MIGf...",
    ],
    fields: [profileField, externalIdField, expectField],
    networked: true,
    path: ["domains", "add"],
    positional: {
      describe: "The domain to track.",
      name: "domain",
      prompt: "Which domain?",
      required: true,
    },
    run: add,
    summary:
      "Register a domain against a profile. Does not touch DNS — it starts pending.",
  },
  {
    authenticated: true,
    examples: [
      "propgate domains update dom_123 --expect dkim.expectedPublicKey=MIGf...NEW",
      "propgate domains update dom_123 --profile full-mail",
    ],
    fields: [{ ...profileField, required: false }, expectField],
    networked: true,
    path: ["domains", "update"],
    positional: idPositional,
    run: update,
    summary:
      "Rotate the values a domain is judged against, re-point its profile, or both. Resets it to pending.",
  },
  {
    authenticated: true,
    examples: [
      "propgate domains list --state failed",
      "propgate domains list --all --json",
    ],
    fields: [
      stateField,
      {
        describe: "Only the domain carrying this id of yours.",
        flag: "external-id",
        kind: "string",
        placeholder: "id",
        prompt: "Which external id?",
        required: false,
      },
      cursorField,
      { ...limitField(MAX_PAGE_LIMIT), validate: positiveInteger },
      allField,
    ],
    networked: true,
    path: ["domains", "list"],
    run: list,
    summary: `Your domains, oldest first. Filter by ${DOMAIN_STATES.join(", ")} or by your own id.`,
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["domains", "get"],
    positional: idPositional,
    run: get,
    summary: "The last known state and the result for every requirement.",
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["domains", "check"],
    positional: idPositional,
    run: verify,
    /**
     * Not the same command as top-level `check`, and the summary has to say so.
     * This one writes: it moves the domain's state, spends the per-tenant check
     * budget, and a transition here is what fires a webhook.
     */
    summary:
      "Re-check a registered domain now. Writes its state and can fire a webhook — unlike `propgate check`, which only reads DNS.",
  },
  {
    authenticated: true,
    fields: [{ ...limitField(MAX_PAGE_LIMIT), validate: positiveInteger }],
    networked: true,
    path: ["domains", "timeline"],
    positional: idPositional,
    run: timeline,
    summary:
      "What has changed for this domain, newest first. Appended to only when an observation actually differs.",
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["domains", "delete"],
    positional: idPositional,
    run: remove,
    summary: "Stop tracking the domain.",
  },
];
