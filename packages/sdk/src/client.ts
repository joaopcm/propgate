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

/**
 * The propgate API, as one object.
 *
 * ```ts
 * const propgate = new Propgate("pg_live_...");
 * const { data, error } = await propgate.domains.check("dom_123");
 * ```
 *
 * Every method returns `{ data, error, meta }` and none of them throw. See
 * `envelope.ts` for why that is the shape, and `error.ts` for what `error`
 * carries.
 */

export const DEFAULT_BASE_URL = "https://api.propgate.dev";

/**
 * Thirty seconds.
 *
 * Sized against the slowest thing the API does: `POST /v1/checks` runs its
 * lookups under a 10-second budget and returns a healthy sending-only domain in
 * 23 ms, so this is a tripwire past where any good request goes rather than a
 * limit a caller should feel. A request that reaches it is one where something
 * between here and the resolver has stopped answering.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Two retries, on top of the first attempt.
 *
 * What they cover is narrow on purpose — see `mayRepeat` in `http.ts`. A
 * connection that never opened and a rate limit that the server said would clear
 * are worth repeating; a `POST` that may already have been applied is not, and
 * no number here changes that.
 */
export const DEFAULT_MAX_RETRIES = 2;

const FIRST_ERROR_STATUS = 400;

export interface PropgateOptions {
  /** Where the API lives. Point this at a local stack in development. */
  readonly baseUrl?: string;
  /**
   * The `fetch` to use.
   *
   * For a caller who needs a proxy agent, a custom TLS setup, or to record what
   * this client sends. Defaults to the global one, which has been there since
   * Node 20.
   */
  readonly fetch?: FetchLike;
  /** How many times a retryable failure may be repeated. Defaults to 2. */
  readonly maxRetries?: number;
  /** Per-request, and overridable per call. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
}

/**
 * `PROPGATE_API_KEY` from the environment, when there is an environment.
 *
 * Guarded rather than assumed: this package works in a browser or an edge
 * runtime for the public checker, where `process` does not exist and touching it
 * is a `ReferenceError` at construction.
 */
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

  /**
   * @param apiKey Your key. Falls back to `PROPGATE_API_KEY`.
   *
   * A missing key is not an error here, because `checks.run` and `health` do not
   * need one. Every other call fails immediately with `code: "missing_api_key"`
   * rather than spending a round trip to be told 401.
   */
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

  /**
   * `GET /health`, the one route that answers something other than the envelope.
   *
   * It is a container healthcheck, so its body is `{"status":"ok"}` and nothing
   * else. Wrapping it in the same result shape as everything here is this
   * method's whole job — a caller should not have to know which routes are
   * enveloped and which are not.
   */
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
      // A body saying "degraded" under a 503 is still an unhealthy service, and
      // reporting it as data would make `error === null` mean "reachable"
      // rather than "healthy".
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
    // Not JSON at all. The caller says what answered instead.
  }
}
