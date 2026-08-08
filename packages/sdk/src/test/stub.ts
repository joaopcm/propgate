import type { FetchLike } from "../http";

/**
 * A `fetch` that answers from a script and records what it was asked.
 *
 * Every spec in this package is about one of two things: what this client puts
 * on the wire, and what it does with what comes back. Both are answerable
 * without a server, and the seam a stub cannot cover — the API answering in a
 * shape this package reads differently than the server writes it — is covered by
 * `apps/api/src/e2e/sdk.e2e.spec.ts` against a real `createApp()`.
 *
 * This is not the mocking invariant 1 bans. Nothing here resolves a name.
 */

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

/** The success envelope, the way `apps/api/src/utils/response.ts` writes it. */
export function envelope(
  data: unknown,
  meta: Record<string, unknown> | null = null,
  status = 200
): Response {
  return json({ data, error: null, meta }, { status });
}

/** The failure envelope, with the status the route would have used. */
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

/**
 * Replies in order; the last one repeats.
 *
 * Repeating rather than running out, so a spec that asserts "this was not
 * retried" fails on the call count rather than on an exhausted script — the
 * former names what went wrong.
 */
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

      /**
       * Cloned, never handed out directly.
       *
       * A `Response` body can be read once, and the last reply is deliberately
       * reused across retries — returning the original would make the second
       * attempt fail with "Body is unusable", which reads like a bug in the
       * retry loop rather than in the harness.
       */
      return Promise.resolve(
        typeof reply === "function" ? reply() : reply.clone()
      );
    },
  };
}

/**
 * One recorded call, or a failure naming which one was missing.
 *
 * Indexing straight into `calls` gives `undefined` and then an assertion about
 * a property of nothing, which reads as "expected undefined to be X" — true, and
 * useless. This says the request was never made.
 */
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

/** A `fetch` that never answers, for timeout specs. */
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
