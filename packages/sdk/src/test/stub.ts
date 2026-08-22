import type { FetchLike } from "../http";

export interface Recorded {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly signal: AbortSignal | undefined;
  readonly url: string;
}

export type Reply = Response | (() => Promise<Response> | Response);

export interface Stub {
  readonly calls: Recorded[];
  readonly fetch: FetchLike;
}

export function json(
  body: unknown,
  init: { headers?: Record<string, string>; status?: number } = {}
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...init.headers },
    status: init.status ?? 200,
  });
}

export function envelope(
  data: unknown,
  meta: Record<string, unknown> | null = null,
  status = 200
): Response {
  return json({ data, error: null, meta }, { status });
}

export function refusal(
  message: string,
  status: number,
  headers?: Record<string, string>
): Response {
  return json(
    { data: null, error: { message }, meta: null },
    { ...(headers === undefined ? {} : { headers }), status }
  );
}

export function stub(replies: readonly Reply[]): Stub {
  const calls: Recorded[] = [];

  return {
    calls,
    fetch: (url, init) => {
      calls.push({
        body:
          typeof init.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        headers: init.headers as Record<string, string>,
        method: init.method ?? "GET",
        signal: init.signal ?? undefined,
        url,
      });

      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];

      if (reply === undefined) {
        throw new Error("stub fetch was called with no replies scripted");
      }

      return Promise.resolve(
        typeof reply === "function" ? reply() : reply.clone()
      );
    },
  };
}

export function callAt(stubbed: Stub, index: number): Recorded {
  const call = stubbed.calls[index];

  if (call === undefined) {
    return failMissing(index, stubbed.calls.length);
  }

  return call;
}

function failMissing(index: number, made: number): never {
  throw new Error(`no request at index ${index}; ${made} were made`);
}

export function silent(): Stub {
  const calls: Recorded[] = [];

  return {
    calls,
    fetch: (url, init) => {
      calls.push({
        body: undefined,
        headers: init.headers as Record<string, string>,
        method: init.method ?? "GET",
        signal: init.signal ?? undefined,
        url,
      });

      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  };
}
