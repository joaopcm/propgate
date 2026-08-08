import type { PropgateResult } from "./envelope";
import { fail, ok, unwrap } from "./envelope";
import type { Query, RequestSpec, Transport } from "./http";
import { send } from "./http";
import type { PageMeta } from "./types";

/**
 * What every resource is handed: the ability to make one request, and to walk a
 * cursor to the end.
 *
 * A class rather than a bound function so the resources read as
 * `this.api.request(...)`, and so the transport is resolved once rather than
 * threaded through every call site.
 */

/** Per-call knobs. Both override whatever the client was constructed with. */
export interface CallOptions {
  /**
   * Cancel the call.
   *
   * The abort is reported as `error.code === "aborted"` rather than thrown, so
   * cancellation lands in the same branch as every other failure.
   */
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * The page size both keyset endpoints cap at.
 *
 * Not a guess: `GET /v1/domains` and `GET /v1/webhooks/:id/deliveries` clamp
 * `limit` to 200 server-side. Asking for the maximum is what makes a full walk
 * one round trip per 200 rows instead of one per 50.
 */
const MAX_PAGE_LIMIT = 200;

export class Caller {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async request<T, M = null>(spec: RequestSpec): Promise<PropgateResult<T, M>> {
    return unwrap<T, M>(await send(this.transport, spec));
  }

  /**
   * Every page, in one array.
   *
   * The one thing this client can offer that a single request cannot. Both paged
   * endpoints return `meta.nextCursor`, null when the walk is done.
   *
   * The two walks are not symmetric, which is worth knowing rather than
   * discovering: domains sort ascending by id, so a row created mid-walk lands at
   * the end and *is* included; deliveries sort descending, so rows created
   * mid-walk are missed. Neither can loop forever — but the cursor guard below
   * does not take that on trust, because a server that ever echoed the cursor it
   * was handed would spin here silently, and a tripwire past where any good
   * response goes costs nothing to leave in.
   */
  async collect<T>(
    spec: RequestSpec & { readonly query?: Query }
  ): Promise<PropgateResult<readonly T[]>> {
    const items: T[] = [];
    let cursor: string | undefined;

    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: each page names where the next begins
      const page = await this.request<T[], PageMeta | null>({
        ...spec,
        query: { ...spec.query, cursor, limit: MAX_PAGE_LIMIT },
      });

      if (page.error !== null) {
        return fail(page.error);
      }

      items.push(...page.data);

      const next = page.meta?.nextCursor;

      if (typeof next !== "string" || next === "" || next === cursor) {
        return ok(items, null);
      }

      cursor = next;
    }
  }
}

/** `dom_01H…` in a path, escaped. Ids are opaque and never assumed URL-safe. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}
