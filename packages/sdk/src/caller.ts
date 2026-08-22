import type { PropgateResult } from "./envelope";
import { fail, ok, unwrap } from "./envelope";
import type { Query, RequestSpec, Transport } from "./http";
import { send } from "./http";
import type { PageMeta } from "./types";

export interface CallOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

const MAX_PAGE_LIMIT = 200;

export class Caller {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async request<T, M = null>(spec: RequestSpec): Promise<PropgateResult<T, M>> {
    return unwrap<T, M>(await send(this.transport, spec));
  }

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

export function segment(value: string): string {
  return encodeURIComponent(value);
}
