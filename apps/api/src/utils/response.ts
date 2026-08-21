import type { Context } from "hono";

/**
 * Every response — success, error, and middleware short-circuit alike — is
 * `{ data, error, meta }`. Keeping the envelope uniform means SDK consumers
 * write one unwrap path instead of one per status code.
 *
 * Errors carry `code` and `hint` as well as `message`. `message` is what went
 * wrong; `code` is the switch an agent can branch on without parsing English;
 * `hint` is what to do next. The SDK still keys on `message` and the HTTP
 * status — extra fields here are additive.
 */

export type ResourceObject = "check" | "lookup" | "diagnosis";

export type ErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 408
  | 409
  | 422
  | 429
  | 500
  | 502;

/**
 * The same names `@propgate/sdk` uses for these statuses.
 *
 * Kept as a table rather than imported from the SDK: this package is the
 * producer of the wire format, and the SDK is a consumer. Importing the
 * consumer's names here would invert that, and a rename in the client would
 * look like an API change.
 */
export const ERROR_CODE_FOR_STATUS: Readonly<Record<ErrorStatus, string>> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  408: "timeout",
  409: "conflict",
  422: "invalid_request",
  429: "rate_limited",
  500: "server_error",
  502: "server_error",
};

export const ERROR_HINT_FOR_CODE: Readonly<Record<string, string>> = {
  conflict:
    "The resource already exists or is in a state that refuses this write. GET it first, then retry with a different name or id.",
  forbidden: "This key is not allowed to perform that action.",
  invalid_request:
    "The request was refused as sent. Fix the named field and retry; sending it unchanged will fail again. See https://docs.propgate.dev/api for the shape.",
  not_found:
    "No resource exists at this path. See GET /openapi.json for the documented routes, or https://docs.propgate.dev/api.",
  rate_limited:
    "Wait for the number of seconds in the Retry-After header, then retry. Limits are documented at https://docs.propgate.dev/api.",
  server_error:
    "Retry with backoff. If it persists, open an issue at https://github.com/joaopcm/propgate/issues.",
  timeout:
    "The check ran out of time talking to DNS. Retry; an indeterminate result is not a verdict about the domain.",
  unauthorized:
    "Send `Authorization: Bearer pg_live_...` using a key from POST /v1/signup/confirm or POST /v1/api-keys. See https://docs.propgate.dev/authentication.",
};

export interface ApiError {
  readonly code: string;
  readonly hint: string;
  readonly message: string;
}

export function errorBody(
  status: ErrorStatus,
  message: string,
  extras?: { code?: string; hint?: string }
): ApiError {
  const code = extras?.code ?? ERROR_CODE_FOR_STATUS[status];
  const hint =
    extras?.hint ??
    ERROR_HINT_FOR_CODE[code] ??
    "See https://docs.propgate.dev/api for the request shape.";

  return { code, hint, message };
}

export function success<T>(
  c: Context,
  data: T,
  meta?: Record<string, unknown>
) {
  return c.json({ data, error: null, meta: meta ?? null });
}

export function listResponse<T>(
  c: Context,
  object: ResourceObject,
  items: T[],
  meta?: Record<string, unknown>
) {
  return c.json({
    data: items.map((item) => ({ object, ...item })),
    error: null,
    meta: meta ?? null,
  });
}

/**
 * 202, for work taken on but not finished when the response is written.
 *
 * Signup is the case: the code is stored, the mail is on its way, and neither
 * the mailbox nor the account exists yet as far as this response can promise.
 * A 200 there would claim something we cannot see.
 */
export function accepted<T>(c: Context, data: T) {
  return c.json({ data, error: null, meta: null }, 202);
}

export function error(
  c: Context,
  status: ErrorStatus,
  message: string,
  extras?: { code?: string; hint?: string }
) {
  return c.json(
    { data: null, error: errorBody(status, message, extras), meta: null },
    status
  );
}
