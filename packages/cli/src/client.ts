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

const MAX_PAGE_LIMIT = "200";

export type Paged<T> =
  | { readonly failure: ApiResult<T[]>; readonly kind: "failed" }
  | { readonly items: readonly T[]; readonly kind: "ok" };

export async function paginate<T>(options: {
  readonly apiKey: string | undefined;
  readonly apiUrl: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
}): Promise<Paged<T>> {
  const items: T[] = [];
  let cursor: string | undefined;

  for (;;) {
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
