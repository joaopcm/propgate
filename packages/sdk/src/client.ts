import type { CallOptions } from "./caller";
import { Caller } from "./caller";
import type { PropgateResult } from "./envelope";
import { fail, ok } from "./envelope";
import { codeForStatus, PropgateError } from "./error";
import type { FetchLike, Transport } from "./http";
import { normaliseBaseUrl, send } from "./http";
import { ApiKeys } from "./resources/api-keys";
import { Checks } from "./resources/checks";
import { Domains } from "./resources/domains";
import { Members } from "./resources/members";
import { Profiles } from "./resources/profiles";
import { Webhooks } from "./resources/webhooks";

export const DEFAULT_BASE_URL = "https://api.propgate.dev";

export const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_MAX_RETRIES = 2;

const FIRST_ERROR_STATUS = 400;

export interface PropgateOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
}

function keyFromEnvironment(): string | undefined {
  if (typeof process === "undefined") {
    return;
  }

  const raw = process.env.PROPGATE_API_KEY?.trim();

  return raw === "" ? undefined : raw;
}

export class Propgate {
  readonly apiKeys: ApiKeys;
  readonly checks: Checks;
  readonly domains: Domains;
  readonly members: Members;
  readonly profiles: Profiles;
  readonly webhooks: Webhooks;

  private readonly transport: Transport;

  constructor(apiKey?: string, options: PropgateOptions = {}) {
    const key = apiKey?.trim();

    this.transport = {
      apiKey: key === undefined || key === "" ? keyFromEnvironment() : key,
      baseUrl: normaliseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    const api = new Caller(this.transport);

    this.apiKeys = new ApiKeys(api);
    this.checks = new Checks(api);
    this.domains = new Domains(api);
    this.members = new Members(api);
    this.profiles = new Profiles(api);
    this.webhooks = new Webhooks(api);
  }

  async health(
    options: CallOptions = {}
  ): Promise<PropgateResult<{ readonly status: string }>> {
    const answer = await send(this.transport, {
      anonymous: true,
      method: "GET",
      path: "/health",
      ...options,
    });

    if ("error" in answer) {
      return fail(answer.error);
    }

    const status = readStatus(answer.text);

    if (answer.status >= FIRST_ERROR_STATUS) {
      return fail(
        new PropgateError({
          code: codeForStatus(answer.status),
          message: `${answer.url} answered ${answer.status}${status === undefined ? "" : ` with status "${status}"`}`,
          statusCode: answer.status,
        })
      );
    }

    if (status === undefined) {
      return fail(
        new PropgateError({
          code: "invalid_response",
          message: `${answer.url} answered ${answer.status} with something that is not a propgate health response`,
          statusCode: answer.status,
        })
      );
    }

    return ok({ status }, null);
  }
}

function readStatus(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { status?: unknown };

    return typeof body.status === "string" ? body.status : undefined;
  } catch {
  }
}
