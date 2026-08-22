import type { Context } from "hono";

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
