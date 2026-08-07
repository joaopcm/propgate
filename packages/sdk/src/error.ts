/**
 * Every way a call can fail, as one value.
 *
 * Nothing in this package throws for a failed call. A method returns
 * `{ data, error, meta }` and the caller narrows on `error === null`, which is
 * the same envelope the API puts on the wire — see `apps/api/src/utils/response.ts`.
 * Returning rather than throwing is what makes the failure path type-checked:
 * a `try`/`catch` gives back `unknown`, and the compiler cannot tell you that you
 * forgot to handle a 409.
 *
 * It is still an `Error` subclass, so a caller who prefers to throw can
 * `throw result.error` and keep a stack, and `instanceof PropgateError` works
 * across the boundary.
 */

/**
 * What kind of failure it was, without parsing the message.
 *
 * Consumers switch on this, so it is a public contract in the same way the
 * diagnosis taxonomy is: adding a member is additive, changing or removing one is
 * a breaking change.
 *
 * `invalid_request` covers both 400 and 422 on purpose. They differ in where the
 * refusal came from and not in what the caller must do about it — the request was
 * refused and re-sending it unchanged will be refused again — and `statusCode`
 * still carries the exact answer for anyone who needs it.
 */
export type PropgateErrorCode =
  /** The request was cancelled through the `signal` the caller passed. */
  | "aborted"
  /** A status this SDK has no more specific name for. */
  | "api_error"
  | "conflict"
  /** The request never reached an API: DNS, TLS, or a refused connection. */
  | "connection_error"
  | "forbidden"
  | "invalid_request"
  /** Something answered, and it was not this API. */
  | "invalid_response"
  /** No key was configured, on a call that requires one. Never sent. */
  | "missing_api_key"
  | "not_found"
  | "rate_limited"
  | "server_error"
  /** No response within `timeoutMs`. */
  | "timeout"
  | "unauthorized";

const STATUS_CODES: Readonly<Record<number, PropgateErrorCode>> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  408: "timeout",
  409: "conflict",
  422: "invalid_request",
  429: "rate_limited",
};

const FIRST_SERVER_ERROR = 500;

/** Which code a status means. Every status the API can answer with is named. */
export function codeForStatus(status: number): PropgateErrorCode {
  return (
    STATUS_CODES[status] ??
    (status >= FIRST_SERVER_ERROR ? "server_error" : "api_error")
  );
}

export class PropgateError extends Error {
  readonly code: PropgateErrorCode;

  /**
   * How long the server asked us to wait, from `Retry-After`, in seconds.
   *
   * Present on `rate_limited` and undefined everywhere else. The client has
   * already waited and retried by the time you see this — see `maxRetries` — so
   * a rate limit that survives to here is one that outlasted the retries, and
   * this is what a caller schedules its own backoff against.
   */
  readonly retryAfterSeconds: number | undefined;

  /**
   * The HTTP status, or 0 when there was never a response.
   *
   * Zero rather than absent so the field is always a number: `connection_error`,
   * `timeout`, `aborted` and `missing_api_key` all failed before any status
   * existed, and `code` is the field that distinguishes them.
   */
  readonly statusCode: number;

  constructor(options: {
    code: PropgateErrorCode;
    message: string;
    retryAfterSeconds?: number | undefined;
    statusCode?: number;
  }) {
    super(options.message);
    this.name = "PropgateError";
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.statusCode = options.statusCode ?? 0;
  }
}
