import { PropgateError } from "./error";

/**
 * The API, over `fetch`.
 *
 * Global `fetch` and no HTTP client, for the same reason `@propgate/cli` has
 * none: the packages this ships beside have zero runtime dependencies, and
 * pulling a request library in to call twenty-one endpoints spends that for
 * nothing. `fetch` has been global and stable since Node 20, which is what
 * `engines` declares.
 *
 * This module knows about requests, retries and transport failures. It does not
 * know what an envelope is — see `envelope.ts` — so the retry policy cannot
 * accidentally depend on what a route happens to return.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** What every request needs, resolved once when the client is constructed. */
export interface Transport {
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST";

export type Query = Readonly<
  Record<string, boolean | number | string | undefined>
>;

export interface RequestSpec {
  /**
   * Send without a key, and do not refuse when there is none.
   *
   * True for exactly two calls: the public checker and the health probe. Every
   * other path is tenant-scoped, and a keyless request to one is a 401 this
   * client can answer without a round trip.
   */
  readonly anonymous?: boolean;
  readonly body?: unknown;
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Query;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

/** What reached the client: a body to interpret, or a failure instead of one. */
export type Answer =
  | { readonly error: PropgateError }
  | {
      readonly retryAfterSeconds: number | undefined;
      readonly status: number;
      readonly text: string;
      readonly url: string;
    };

/**
 * How long a retry may wait before the client stops retrying at all.
 *
 * A tripwire against the failure this retry loop could otherwise introduce:
 * `POST /v1/domains/:id/checks` is limited to 100 a minute and answers
 * `Retry-After: 47`, so honouring that inside the call turns one `await` into a
 * silent 47-second stall — twice, at the default `maxRetries`. Past this ceiling
 * the rate limit comes back as an error carrying `retryAfterSeconds`, and
 * scheduling around it is the caller's decision to make, with its own knowledge
 * of how long it is allowed to block.
 *
 * So the worst case for one call is bounded and statable: `timeoutMs * (1 +
 * maxRetries)` of request time plus at most `maxRetries * 5s` of waiting — 65
 * seconds at the defaults, and only if every attempt times out.
 */
const MAX_RETRY_WAIT_MS = 5000;

/**
 * The first backoff step, doubling per attempt: 250ms, then 500ms.
 *
 * Not a measurement — there is nothing to measure about how long somebody else's
 * transient failure lasts. It is short enough that two retries are invisible
 * beside one DNS check, and long enough not to be three requests inside the same
 * millisecond.
 */
const RETRY_BASE_DELAY_MS = 250;

const MS_PER_SECOND = 1000;
const TOO_MANY_REQUESTS = 429;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  TOO_MANY_REQUESTS,
  500,
  502,
  503,
  504,
]);
const TRAILING_SLASHES = /\/+$/;

/** `?state=failed&limit=200`, skipping anything absent. */
export function queryString(query: Query = {}): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }

  const rendered = search.toString();

  return rendered === "" ? "" : `?${rendered}`;
}

/** The base URL as the client stores it: no trailing slash, so paths append. */
export function normaliseBaseUrl(raw: string): string {
  return raw.replace(TRAILING_SLASHES, "");
}

/**
 * Wait, unless the caller stops waiting.
 *
 * Resolves either way — the loop checks the signal afterwards. A backoff that
 * ignored the signal would hold a cancelled call open for up to the ceiling and
 * then spend one more `fetch` on a signal that is already aborted.
 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal === undefined) {
      setTimeout(resolve, ms);

      return;
    }

    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);

    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * The per-request budget, or a complaint about the value it was given.
 *
 * `AbortSignal.timeout` throws a `TypeError` on anything that is not a
 * non-negative integer, and it does so at the top of `attempt` — outside the
 * `try`, so it would escape as the one exception this package can throw. A
 * caller who passes `NaN` deserves to be told which option and which value,
 * through the same channel as every other failure.
 */
function budgetFor(
  spec: RequestSpec,
  transport: Transport
): number | PropgateError {
  const raw = spec.timeoutMs ?? transport.timeoutMs;

  /**
   * Zero is refused along with the nonsense values, and deliberately.
   *
   * `AbortSignal.timeout(0)` aborts before the request leaves, so a caller who
   * wrote `timeoutMs: 0` meaning "no limit" — which is what it means nearly
   * everywhere else — would get a client where every single call times out.
   * Refusing it says so; honouring it would take an afternoon to diagnose.
   */
  if (!(Number.isFinite(raw) && raw > 0)) {
    return new PropgateError({
      code: "invalid_option",
      message: `timeoutMs must be a positive number of milliseconds, got ${raw}`,
    });
  }

  // Truncated rather than refused: a fractional millisecond is a computed value
  // rather than a typo, and `AbortSignal.timeout` will not take one.
  return Math.floor(raw);
}

/**
 * `Retry-After` in seconds, or undefined when it is absent or not a number.
 *
 * Only the delta-seconds form is read. The HTTP-date form is legal and this API
 * never sends it; treating an unparseable value as absent falls back to the
 * backoff, which is the safe direction to be wrong in.
 */
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");

  if (raw === null) {
    return;
  }

  const seconds = Number(raw);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Whether a failed attempt of this method may be repeated.
 *
 * `POST` is the only method here that is not idempotent, and the distinction is
 * not academic: `POST /v1/api-keys` mints a key every time it is called, so a
 * retry after a timeout is a second key nobody knows about. `POST /v1/domains`
 * and `POST /v1/webhooks` are idempotent by construction, but that is a property
 * of those two routes rather than of the method, and a rule that has to be right
 * per route is a rule that will be wrong the first time a route is added.
 *
 * A 429 is the exception, and the only one: the server refused before doing
 * anything, so repeating the request cannot repeat an effect. That is what makes
 * rate limits worth riding out here and 500s not.
 */
function mayRepeat(method: HttpMethod, status: number | undefined): boolean {
  return method !== "POST" || status === TOO_MANY_REQUESTS;
}

type Attempt =
  | {
      readonly error: PropgateError;
      readonly kind: "failed";
      readonly retryable: boolean;
    }
  | {
      readonly kind: "answered";
      readonly retryAfterSeconds: number | undefined;
      readonly status: number;
      readonly text: string;
      readonly url: string;
    };

async function attempt(
  transport: Transport,
  spec: RequestSpec,
  url: string,
  timeoutMs: number
): Promise<Attempt> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal =
    spec.signal === undefined
      ? timeout
      : AbortSignal.any([spec.signal, timeout]);
  let response: Response;

  try {
    response = await transport.fetch(url, {
      ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
      headers: {
        accept: "application/json",
        ...(spec.anonymous === true || transport.apiKey === undefined
          ? {}
          : { authorization: `Bearer ${transport.apiKey}` }),
        ...(spec.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      method: spec.method,
      signal,
    });
  } catch (cause) {
    /**
     * Three failures arrive here as one rejection and need different answers: a
     * request the caller cancelled must never be retried, a timeout usually
     * should be, and anything else is the network.
     */
    if (spec.signal?.aborted === true) {
      return {
        error: new PropgateError({
          code: "aborted",
          message: "the request was aborted by its caller",
        }),
        kind: "failed",
        retryable: false,
      };
    }

    if (timeout.aborted) {
      return {
        error: new PropgateError({
          code: "timeout",
          message: `${url} did not answer within ${timeoutMs}ms`,
        }),
        kind: "failed",
        retryable: mayRepeat(spec.method, undefined),
      };
    }

    // DNS failure, refused connection, TLS problem. Name the URL: the most
    // common cause by far is a `baseUrl` pointing somewhere stale.
    return {
      error: new PropgateError({
        code: "connection_error",
        message: `could not reach ${url}: ${(cause as Error).message}`,
      }),
      kind: "failed",
      retryable: mayRepeat(spec.method, undefined),
    };
  }

  let text: string;

  try {
    text = await response.text();
  } catch (cause) {
    /**
     * Headers arrived and the body did not — a connection dropped mid-response.
     *
     * Caught rather than left to propagate, because a rejection escaping here
     * would be the one place this package throws, and it would do it from
     * whichever call happened to be running when somebody's network blipped.
     */
    return {
      error: new PropgateError({
        code: "connection_error",
        message: `${url} answered ${response.status} but the body did not arrive: ${(cause as Error).message}`,
        statusCode: response.status,
      }),
      kind: "failed",
      retryable: mayRepeat(spec.method, undefined),
    };
  }

  return {
    kind: "answered",
    retryAfterSeconds: retryAfterSeconds(response),
    status: response.status,
    text,
    url,
  };
}

/**
 * How long before the next attempt, or undefined to stop retrying.
 *
 * One function for both branches so the ceiling cannot apply to a rate limit and
 * not to a backoff — which is what it did before this existed, leaving
 * `maxRetries: 10` to wait 128 seconds on the ninth attempt of something the
 * caller thought was a quick GET.
 */
function nextWaitMs(input: {
  attemptsMade: number;
  exhausted: boolean;
  retryAfterSeconds: number | undefined;
  retryable: boolean;
}): number | undefined {
  if (input.exhausted || !input.retryable) {
    return;
  }

  const waitMs =
    input.retryAfterSeconds === undefined
      ? RETRY_BASE_DELAY_MS * 2 ** input.attemptsMade
      : input.retryAfterSeconds * MS_PER_SECOND;

  return waitMs > MAX_RETRY_WAIT_MS ? undefined : waitMs;
}

/**
 * One call, with its retries.
 *
 * The retry loop lives here and nowhere else, so no resource can opt out of it
 * by accident or invent a second policy. Every status that is not retried —
 * including the 4xx a caller cares most about — comes back as an answer to
 * interpret rather than as an error, because what a 404 or a 422 *means* is a
 * question about the envelope and not about HTTP.
 */
export async function send(
  transport: Transport,
  spec: RequestSpec
): Promise<Answer> {
  if (spec.anonymous !== true && transport.apiKey === undefined) {
    return {
      error: new PropgateError({
        code: "missing_api_key",
        message:
          "no API key: pass one to `new Propgate(apiKey)` or set PROPGATE_API_KEY",
      }),
    };
  }

  const budget = budgetFor(spec, transport);

  if (budget instanceof PropgateError) {
    return { error: budget };
  }

  const url = `${transport.baseUrl}${spec.path}${queryString(spec.query)}`;

  for (let attemptsMade = 0; ; attemptsMade += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: a retry is by definition what happens after the previous attempt
    const outcome = await attempt(transport, spec, url, budget);
    const exhausted = attemptsMade >= transport.maxRetries;
    const waitMs = nextWaitMs({
      attemptsMade,
      exhausted,
      retryAfterSeconds:
        outcome.kind === "answered" ? outcome.retryAfterSeconds : undefined,
      retryable:
        outcome.kind === "failed"
          ? outcome.retryable
          : RETRYABLE_STATUSES.has(outcome.status) &&
            mayRepeat(spec.method, outcome.status),
    });

    if (waitMs === undefined) {
      return outcome.kind === "failed" ? { error: outcome.error } : outcome;
    }

    await sleep(waitMs, spec.signal);

    if (spec.signal?.aborted === true) {
      // Cancelled mid-backoff. Spending another `fetch` on a signal that is
      // already aborted would only produce the same answer more slowly.
      return {
        error: new PropgateError({
          code: "aborted",
          message: "the request was aborted by its caller",
        }),
      };
    }
  }
}
