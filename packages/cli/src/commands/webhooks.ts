import { apiRequest, paginate, queryString } from "../client";
import type { Command, Input } from "../command";
import { type Context, json, out, reportApiError, usage } from "../output";
import { table, when } from "../table";
import {
  allField,
  cursorField,
  DELIVERY_STATUSES,
  EVENT_CHOICES,
  limitField,
  positiveInteger,
} from "./shared";

/** Everything under `/v1/webhooks`. */

const MAX_DELIVERY_LIMIT = 200;
const MAX_ROTATION_WINDOW_HOURS = 168;

interface WebhookRow {
  readonly createdAt: string;
  readonly disabled: boolean;
  readonly events: readonly string[];
  readonly id: string;
  readonly secret?: string;
  readonly url: string;
}

/** Empty means every event, which is what an omitted `events` produces. */
function events(row: WebhookRow): string {
  return row.events.length === 0 ? "all events" : row.events.join(", ");
}

function show(row: WebhookRow): void {
  for (const line of table([
    ["id", row.id],
    ["url", row.url],
    ["events", events(row)],
    ["state", row.disabled ? "disabled" : "enabled"],
    ["created", when(row.createdAt)],
  ])) {
    out(`  ${line}`);
  }
}

async function create(input: Input, context: Context): Promise<number> {
  const chosen = input.list("events");
  const result = await apiRequest<WebhookRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: {
      ...(chosen.length === 0 ? {} : { events: chosen }),
      url: input.need("url"),
    },
    method: "POST",
    path: "/v1/webhooks",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not create the webhook"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  const created = result.body.data;

  out(
    result.body.meta?.created === true
      ? "Created."
      : "That URL is already registered. Nothing changed."
  );
  out("");
  show(created);

  if (created.secret !== undefined) {
    out("");
    out(`  signing secret  ${created.secret}`);
    out("");
    // The endpoint is idempotent on the URL and only returns a secret on the call
    // that actually created the row, so there is no second chance at this one.
    out(
      "Shown once. Rotate with `propgate webhooks rotate <id>` if it is lost."
    );
  }

  return 0;
}

async function list(_input: Input, context: Context): Promise<number> {
  const result = await apiRequest<WebhookRow[]>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: "/v1/webhooks",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not list webhooks"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  if (result.body.data.length === 0) {
    out(
      "No webhooks. Add one with `propgate webhooks create --url https://…`."
    );

    return 0;
  }

  for (const line of table(
    result.body.data.map((row) => [
      row.disabled ? "disabled" : "enabled",
      row.url,
      events(row),
    ])
  )) {
    out(line);
  }

  return 0;
}

async function get(input: Input, context: Context): Promise<number> {
  const result = await apiRequest<WebhookRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/webhooks/${encodeURIComponent(input.needPositional())}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not read the webhook"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  show(result.body.data);

  return 0;
}

async function update(input: Input, context: Context): Promise<number> {
  const chosen = input.list("events");
  const state = input.text("state");

  if ((state === undefined || state === "unchanged") && chosen.length === 0) {
    // The API accepts a PATCH with an empty body and changes nothing. Reporting
    // success for a request that did nothing is worse than naming the flag.
    return usage(
      "webhooks update needs --events or --state; without one of them there is nothing to change"
    );
  }

  const result = await apiRequest<WebhookRow>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: {
      ...(state === undefined || state === "unchanged"
        ? {}
        : { disabled: state === "disabled" }),
      ...(chosen.length === 0 ? {} : { events: chosen }),
    },
    method: "PATCH",
    path: `/v1/webhooks/${encodeURIComponent(input.needPositional())}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not update the webhook"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  show(result.body.data);

  return 0;
}

async function remove(input: Input, context: Context): Promise<number> {
  const id = input.needPositional();
  const result = await apiRequest<{ deleted: boolean; id: string }>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    method: "DELETE",
    path: `/v1/webhooks/${encodeURIComponent(id)}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not delete the webhook"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  out(`${id} is gone. Nothing more will be delivered to it.`);

  return 0;
}

async function rotate(input: Input, context: Context): Promise<number> {
  const windowHours = input.text("window-hours");
  const result = await apiRequest<{ id: string; secret: string }>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: windowHours === undefined ? {} : { windowHours },
    method: "POST",
    path: `/v1/webhooks/${encodeURIComponent(input.needPositional())}/secret`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not rotate the secret"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  out(result.body.data.secret);
  out("");

  const expires = result.body.meta?.previousSecretExpiresAt;

  out(
    typeof expires === "string"
      ? `Shown once. The previous secret keeps verifying until ${when(expires)}, so deploy this one before then.`
      : "Shown once."
  );

  return 0;
}

interface DeliveryRow {
  readonly attempts: number;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly domainId: string;
  readonly event: string;
  readonly id: string;
  readonly lastError: string | null;
  readonly status: string;
}

function deliveryLines(rows: readonly DeliveryRow[]): string[] {
  return table(
    rows.map((row) => [
      row.status,
      row.event,
      when(row.createdAt),
      `${row.attempts} attempt${row.attempts === 1 ? "" : "s"}`,
      row.lastError ?? "",
    ])
  );
}

async function deliveries(input: Input, context: Context): Promise<number> {
  const id = encodeURIComponent(input.needPositional());
  const status = input.text("status");
  const cursor = input.text("cursor");

  if (input.bool("all") && cursor !== undefined) {
    return usage(
      "--all walks every page from the start; --cursor says where to start. Pick one."
    );
  }

  if (input.bool("all")) {
    const walked = await paginate<DeliveryRow>({
      apiKey: context.apiKey,
      apiUrl: context.apiUrl,
      path: `/v1/webhooks/${id}/deliveries`,
      query: { status },
    });

    if (walked.kind === "failed") {
      return reportApiError(
        walked.failure.status,
        walked.failure.body.error?.message,
        "could not list deliveries"
      );
    }

    if (context.json) {
      return json({
        data: walked.items,
        error: null,
        meta: { nextCursor: null },
      });
    }

    for (const line of deliveryLines(walked.items)) {
      out(line);
    }

    return 0;
  }

  const result = await apiRequest<DeliveryRow[]>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/webhooks/${id}/deliveries${queryString({
      cursor,
      limit: input.text("limit"),
      status,
    })}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not list deliveries"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  if (result.body.data.length === 0) {
    out("Nothing delivered yet.");

    return 0;
  }

  for (const line of deliveryLines(result.body.data)) {
    out(line);
  }

  const next = result.body.meta?.nextCursor;

  if (typeof next === "string" && next !== "") {
    out("");
    out(`More rows. Continue with --cursor ${next}, or pass --all.`);
  }

  return 0;
}

const eventsField = {
  choices: EVENT_CHOICES,
  describe: "Which events to send. Omitted means all of them.",
  flag: "events",
  kind: "multiselect" as const,
  prompt: "Which events? Select none for all of them",
  /**
   * Optional to the API, always asked for in a terminal.
   *
   * Without this the guided flow skipped straight past every optional field and
   * `webhooks update` — whose fields are all optional individually but not
   * collectively — errored instead of asking anything.
   */
  promptWhenOptional: true,
  required: false,
};

const idPositional = {
  describe: "The webhook id from `webhooks list`.",
  name: "id",
  prompt: "Which webhook id?",
  required: true,
};

export const webhooksCommands: readonly Command[] = [
  {
    authenticated: true,
    examples: [
      "propgate webhooks create --url https://example.com/hooks --events domain.failed,domain.recovered",
    ],
    fields: [
      {
        describe: "Where to POST. https only, and not a private address.",
        flag: "url",
        kind: "string",
        placeholder: "https://…",
        prompt: "Where should we POST?",
        required: true,
        validate: (value) =>
          value.startsWith("https://")
            ? undefined
            : "a webhook URL must start with https://",
      },
      eventsField,
    ],
    networked: true,
    path: ["webhooks", "create"],
    run: create,
    summary:
      "Register an endpoint. Idempotent on the URL — the signing secret is returned only on the call that creates it.",
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["webhooks", "list"],
    run: list,
    summary: "Your endpoints.",
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["webhooks", "get"],
    positional: idPositional,
    run: get,
    summary: "One endpoint.",
  },
  {
    authenticated: true,
    examples: ["propgate webhooks update <id> --state disabled"],
    fields: [
      eventsField,
      {
        choices: [
          { hint: "Deliver as normal.", value: "enabled" },
          {
            hint: "Stop delivering. Nothing is queued while it is off.",
            value: "disabled",
          },
          { hint: "Change the events only.", value: "unchanged" },
        ],
        /**
         * One field rather than `--disable` and `--enable`.
         *
         * Two boolean flags for one two-valued thing means a caller can pass
         * both, which needs a guard, an error message and a spec for a state
         * that should never have been expressible. A `select` cannot contradict
         * itself, and it is the shape a prompt wants anyway.
         */
        describe: "Whether to deliver to this endpoint.",
        flag: "state",
        kind: "select",
        prompt: "Should this endpoint be delivering?",
        promptWhenOptional: true,
        required: false,
      },
    ],
    networked: true,
    path: ["webhooks", "update"],
    positional: idPositional,
    run: update,
    summary: "Change which events an endpoint receives, or turn it off.",
  },
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["webhooks", "delete"],
    positional: idPositional,
    run: remove,
    summary: "Remove an endpoint.",
  },
  {
    authenticated: true,
    examples: ["propgate webhooks rotate <id> --window-hours 0"],
    fields: [
      {
        describe: `How long the previous secret keeps verifying, 0 to ${MAX_ROTATION_WINDOW_HOURS}. Defaults to 24. Zero expires it immediately.`,
        flag: "window-hours",
        kind: "string",
        placeholder: "hours",
        prompt: "How many hours should the previous secret keep working?",
        required: false,
        validate: (value) => {
          const parsed = Number(value);

          return Number.isInteger(parsed) &&
            parsed >= 0 &&
            parsed <= MAX_ROTATION_WINDOW_HOURS
            ? undefined
            : `a rotation window is 0 to ${MAX_ROTATION_WINDOW_HOURS} hours`;
        },
      },
    ],
    networked: true,
    path: ["webhooks", "rotate"],
    positional: idPositional,
    run: rotate,
    summary:
      "Issue a new signing secret. The previous one keeps verifying for a window, so a deploy does not have to be instant.",
  },
  {
    authenticated: true,
    examples: ["propgate webhooks deliveries <id> --status failed --all"],
    fields: [
      {
        choices: DELIVERY_STATUSES.map((value) => ({ value })),
        describe: "Only deliveries in this state.",
        flag: "status",
        kind: "select",
        prompt: "Which status?",
        required: false,
      },
      cursorField,
      { ...limitField(MAX_DELIVERY_LIMIT), validate: positiveInteger },
      allField,
    ],
    networked: true,
    path: ["webhooks", "deliveries"],
    positional: idPositional,
    run: deliveries,
    summary:
      "What has been sent to this endpoint, newest first. What is owed lives in Postgres, so this survives a flushed Redis.",
  },
];
