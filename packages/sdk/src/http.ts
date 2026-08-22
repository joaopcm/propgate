import { PropgateError } from "./error";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

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
  readonly anonymous?: boolean;
  readonly body?: unknown;
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Query;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export type Answer =
  | { readonly error: PropgateError }
  | {
      readonly retryAfterSeconds: number | undefined;
      readonly status: number;
      readonly text: string;
      readonly url: string;
    };

export const MAX_RETRY_WAIT_MS = 5000;

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

export function normaliseBaseUrl(raw: string): string {
  return raw.replace(TRAILING_SLASHES, "");
}

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

function budgetFor(
  spec: RequestSpec,
  transport: Transport
): number | PropgateError {
  const raw = spec.timeoutMs ?? transport.timeoutMs;

  if (!(Number.isFinite(raw) && raw > 0)) {
    return new PropgateError({
      code: "invalid_option",
      message: `timeoutMs must be a positive number of milliseconds, got ${raw}`,
    });
  }

  return Math.floor(raw);
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");

  if (raw === null) {
    return;
  }

  const seconds = Number(raw);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

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

function abortedByCaller(): Attempt {
  return {
    error: new PropgateError({
      code: "aborted",
      message: "the request was aborted by its caller",
    }),
    kind: "failed",
    retryable: false,
  };
}

function timedOut(url: string, timeoutMs: number, method: HttpMethod): Attempt {
  return {
    error: new PropgateError({
      code: "timeout",
      message: `${url} did not answer within ${timeoutMs}ms`,
    }),
    kind: "failed",
    retryable: mayRepeat(method, undefined),
  };
}

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
    if (spec.signal?.aborted === true) {
      return abortedByCaller();
    }

    if (timeout.aborted) {
      return timedOut(url, timeoutMs, spec.method);
    }

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
    if (spec.signal?.aborted === true) {
      return abortedByCaller();
    }

    if (timeout.aborted) {
      return timedOut(url, timeoutMs, spec.method);
    }

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
      return {
        error: new PropgateError({
          code: "aborted",
          message: "the request was aborted by its caller",
        }),
      };
    }
  }
}
