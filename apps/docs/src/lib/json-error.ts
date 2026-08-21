/**
 * Structured JSON errors for the docs machine-readable surface.
 *
 * Same envelope the product API puts on the wire: `{ data, error, meta }`
 * with `code`, `message`, and `hint`. This is what docs.propgate.dev
 * answers when a catalog path is missing or a method is wrong.
 */

export type DocsErrorCode =
  | "method_not_allowed"
  | "not_found"
  | "unsupported_media_type";

export interface DocsErrorBody {
  readonly data: null;
  readonly error: {
    readonly code: DocsErrorCode;
    readonly hint: string;
    readonly message: string;
  };
  readonly meta: null;
}

export const DOCS_ERROR_HINTS: Record<DocsErrorCode, string> = {
  method_not_allowed:
    "This path only accepts the methods listed in Allow. See GET /openapi.json.",
  not_found:
    "No such path. GET /v1/pages for the catalog, GET /openapi.json for the spec, or GET /llms.txt for the index.",
  unsupported_media_type:
    "Send Accept: application/json for this path, or see GET /openapi.json.",
};

export function docsError(
  code: DocsErrorCode,
  message: string,
  hint = DOCS_ERROR_HINTS[code]
): DocsErrorBody {
  return {
    data: null,
    error: { code, hint, message },
    meta: null,
  };
}

export function jsonErrorResponse(
  status: 404 | 405 | 415,
  code: DocsErrorCode,
  message: string,
  extraHeaders?: HeadersInit
): Response {
  return Response.json(docsError(code, message), {
    headers: extraHeaders,
    status,
  });
}
