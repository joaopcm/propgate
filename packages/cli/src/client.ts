/**
 * The API, over `fetch`.
 *
 * Global `fetch` and nothing else. This package is published MIT as the
 * credibility artifact for a resolver with zero runtime dependencies, and adding
 * an HTTP client to call four endpoints would undercut that claim for no gain.
 *
 * `fetch` has been global and stable since Node 20, which is what `engines` now
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
