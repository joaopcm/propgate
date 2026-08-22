export const PROPGATE_ERROR_CODES = [
  "aborted",
  "api_error",
  "conflict",
  "connection_error",
  "forbidden",
  "invalid_option",
  "invalid_request",
  "invalid_response",
  "missing_api_key",
  "not_found",
  "rate_limited",
  "server_error",
  "timeout",
  "unauthorized",
] as const;

export type PropgateErrorCode = (typeof PROPGATE_ERROR_CODES)[number];

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

export function codeForStatus(status: number): PropgateErrorCode {
  return (
    STATUS_CODES[status] ??
    (status >= FIRST_SERVER_ERROR ? "server_error" : "api_error")
  );
}

export class PropgateError extends Error {
  readonly code: PropgateErrorCode;

  readonly retryAfterSeconds: number | undefined;

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
