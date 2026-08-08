import { codeForStatus, PropgateError } from "./error";
import type { Answer } from "./http";

/**
 * `{ data, error, meta }`, the same envelope the API writes.
 *
 * Kept rather than flattened, because all three carry something a caller needs:
 * `meta` is where `nextCursor` lives, where a create says whether it *created*,
 * and where a check says which resolver answered.
 *
 * The union is discriminated on `error`, so one `if (result.error !== null)`
 * narrows `data` to non-null for the rest of the function. That is the whole
 * ergonomic argument for returning failures instead of throwing them: a `catch`
 * binds `unknown` and the compiler never mentions the case you forgot.
 */
export type PropgateResult<T, M = null> =
  | { readonly data: null; readonly error: PropgateError; readonly meta: null }
  | { readonly data: T; readonly error: null; readonly meta: M };

export function ok<T, M>(data: T, meta: M): PropgateResult<T, M> {
  return { data, error: null, meta };
}

export function fail<T, M>(error: PropgateError): PropgateResult<T, M> {
  return { data: null, error, meta: null };
}

const FIRST_ERROR_STATUS = 400;

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON at all. The caller says what answered instead.
  }
}

/**
 * A response body as a result.
 *
 * Anything that is not this API's envelope becomes `invalid_response` naming the
 * URL, rather than a `TypeError` about a property of undefined. The common cause
 * is a proxy, a captive portal or a tunnel answering instead of the API, and
 * saying so beats a JSON parse error naming a position in a document the reader
 * never asked for.
 */
export function unwrap<T, M = null>(answer: Answer): PropgateResult<T, M> {
  if ("error" in answer) {
    return fail(answer.error);
  }

  const body = parse(answer.text);

  if (typeof body !== "object" || body === null || !("data" in body)) {
    return fail(
      new PropgateError({
        code: "invalid_response",
        message: `${answer.url} answered ${answer.status} with something that is not a propgate response envelope`,
        statusCode: answer.status,
      })
    );
  }

  const envelope = body as {
    data: T;
    error: { message?: unknown } | null;
    meta?: M;
  };
  const message =
    typeof envelope.error?.message === "string"
      ? envelope.error.message
      : undefined;

  if (message !== undefined || answer.status >= FIRST_ERROR_STATUS) {
    return fail(
      new PropgateError({
        code: codeForStatus(answer.status),
        message: message ?? `${answer.url} answered ${answer.status}`,
        retryAfterSeconds: answer.retryAfterSeconds,
        statusCode: answer.status,
      })
    );
  }

  return ok(envelope.data, (envelope.meta ?? null) as M);
}
