/**
 * The API, over `fetch`.
 *
 * Global `fetch` and no HTTP client. The resolver this package is published
 * alongside has zero runtime dependencies, and pulling in a request library to
 * call twenty-two endpoints would spend that for nothing — `fetch` already does
 * everything asked of it here.
 *
 * `fetch` has been global and stable since Node 20, which is what `engines`
 * declares — it was previously unset, and these commands are the first thing here
 * that would actually break on an older runtime rather than merely be untested on
 * one.
 */

export interface Envelope<T> {
  readonly data: T | null;
  readonly error: { readonly message: string } | null;
  readonly meta: Record<string, unknown> | null;
}

export interface ApiResult<T> {
  readonly body: Envelope<T>;
  readonly ok: boolean;
  readonly status: number;
}

export interface RequestOptions {
  readonly apiKey?: string | undefined;
  readonly apiUrl: string;
  readonly body?: unknown;
  readonly method?: string;
  readonly path: string;
}

/**
 * One request, with the failure modes turned into values.
 *
 * Nothing here throws for an HTTP status or an unparseable body. A CLI's job on a
 * bad response is to print something the reader can act on, and that is easier to
 * get right when every path returns the same shape.
 */
const TRAILING_SLASHES = /\/+$/;

export async function apiRequest<T>(
  options: RequestOptions
): Promise<ApiResult<T>> {
  const url = `${options.apiUrl.replace(TRAILING_SLASHES, "")}${options.path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      headers: {
        ...(options.apiKey === undefined
          ? {}
          : { authorization: `Bearer ${options.apiKey}` }),
        "content-type": "application/json",
      },
      method: options.method ?? "GET",
    });
  } catch (cause) {
    // DNS failure, refused connection, TLS problem. Name the URL: the most common
    // cause by far is --api-url or PROPGATE_API_URL pointing somewhere stale.
    return {
      body: {
        data: null,
        error: {
          message: `could not reach ${url}: ${(cause as Error).message}`,
        },
        meta: null,
      },
      ok: false,
      status: 0,
    };
  }

  const text = await response.text();

  if (text === "") {
    return {
      body: { data: null, error: null, meta: null },
      ok: response.ok,
      status: response.status,
    };
  }

  try {
    return {
      body: JSON.parse(text) as Envelope<T>,
      ok: response.ok,
      status: response.status,
    };
  } catch {
    /**
     * Not JSON at all.
     *
     * Which means something other than the API answered — a proxy's error page, a
     * captive portal, a tunnel that is down. Saying so beats a JSON parse error
     * naming a position in a document the reader never asked for.
     */
    return {
      body: {
        data: null,
        error: {
          message: `${url} answered ${response.status} with something that is not JSON; is that the propgate API?`,
        },
        meta: null,
      },
      ok: false,
      status: response.status,
    };
  }
}

/** `?state=failed&limit=200`, skipping anything absent. */
export function queryString(
  query: Readonly<Record<string, string | undefined>>
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }

  const rendered = search.toString();

  return rendered === "" ? "" : `?${rendered}`;
}

/**
 * The page size both keyset endpoints cap at.
 *
 * Not a guess: `GET /v1/domains` and `GET /v1/webhooks/:id/deliveries` both clamp
 * `limit` to 200 server-side. Asking for the maximum is what makes `--all` one
 * round trip per 200 rows instead of one per 50.
 */
const MAX_PAGE_LIMIT = "200";

export type Paged<T> =
  | { readonly failure: ApiResult<T[]>; readonly kind: "failed" }
  | { readonly items: readonly T[]; readonly kind: "ok" };

/**
 * Walk a cursor to the end.
 *
 * The one thing the CLI can offer that a single request cannot. Both paged
 * endpoints return `meta.nextCursor`, null when the walk is done.
 *
 * The two walks are not symmetric, which is worth knowing rather than
 * discovering: domains sort ascending by id, so a row created while the walk is
 * in progress lands at the end and *is* included; deliveries sort descending, so
 * rows created mid-walk are simply missed. Neither can loop forever — but the
 * guard below does not take that on trust, because a server that ever answered
 * with the cursor it was handed would spin here silently, and a tripwire past
 * where any good response goes costs nothing to leave in.
 */
export async function paginate<T>(options: {
  readonly apiKey: string | undefined;
  readonly apiUrl: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
}): Promise<Paged<T>> {
  const items: T[] = [];
  let cursor: string | undefined;

  for (;;) {
    /**
     * Sequential by nature: each request needs the cursor the last one returned.
     * `Promise.all` has nothing to parallelise here.
     */
    // biome-ignore lint/performance/noAwaitInLoops: each page names where the next begins
    const result = await apiRequest<T[]>({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      path: `${options.path}${queryString({
        ...options.query,
        cursor,
        limit: MAX_PAGE_LIMIT,
      })}`,
    });

    if (!result.ok || result.body.data === null) {
      return { failure: result, kind: "failed" };
    }

    items.push(...result.body.data);

    const next = result.body.meta?.nextCursor;

    if (typeof next !== "string" || next === "") {
      return { items, kind: "ok" };
    }

    if (next === cursor) {
      return { items, kind: "ok" };
    }

    cursor = next;
  }
}
