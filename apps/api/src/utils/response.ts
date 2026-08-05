import type { Context } from "hono";

/**
 * Every response — success, error, and middleware short-circuit alike — is
 * `{ data, error, meta }`. Keeping the envelope uniform means SDK consumers
 * write one unwrap path instead of one per status code.
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

export function error(c: Context, status: ErrorStatus, message: string) {
  return c.json({ data: null, error: { message }, meta: null }, status);
}
