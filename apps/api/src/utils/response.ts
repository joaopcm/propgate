import type { Context } from "hono";

/**
 * Every response — success, error, and middleware short-circuit alike — is
 * `{ data, error, meta }`. Keeping the envelope uniform means SDK consumers
 * write one unwrap path instead of one per status code.
 */

export type ResourceObject = "check" | "lookup" | "diagnosis";

export type ErrorStatus = 400 | 401 | 403 | 404 | 408 | 422 | 429 | 500 | 502;

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

export function error(c: Context, status: ErrorStatus, message: string) {
  return c.json({ data: null, error: { message }, meta: null }, status);
}
