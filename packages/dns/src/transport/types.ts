import type { ServerAddress, Transport } from "../types";
import type { Message } from "../wire/message";

/**
 * Query outcomes as values.
 *
 * A timeout, a refusal, and a mangled response are all *observations* about a
 * domain's DNS, not exceptional conditions in our program. Modelling them as
 * throws would push every caller into try/catch and, worse, make it easy to
 * collapse distinct outcomes into one `catch` — which is exactly how a resolver
 * ends up reporting "not found" for a server that was merely slow.
 */
export type QueryOutcome =
  | {
      readonly status: "answered";
      readonly message: Message;
      readonly transport: Transport;
      /** True when a truncated UDP answer was retried over TCP. */
      readonly retriedOverTcp: boolean;
      readonly elapsedMs: number;
    }
  | {
      readonly status: "timeout";
      readonly transport: Transport;
      readonly timeoutMs: number;
      readonly elapsedMs: number;
    }
  | {
      /** Connection refused, host unreachable, network down. */
      readonly status: "unreachable";
      readonly transport: Transport;
      readonly code: string;
      readonly detail: string;
      readonly elapsedMs: number;
    }
  | {
      readonly status: "malformed";
      readonly transport: Transport;
      readonly reason: string;
      readonly offset: number;
      readonly detail: string;
      readonly elapsedMs: number;
    }
  | {
      /**
       * A truncated UDP answer where the caller asked us not to retry. Kept
       * separate from "answered with tc set" so a caller cannot ignore it by
       * accident.
       */
      readonly status: "truncated";
      readonly message: Message;
      readonly transport: "udp";
      readonly elapsedMs: number;
    };

export interface QuerySpec {
  readonly checkingDisabled?: boolean;
  readonly dnssecOk?: boolean;
  /** Omit to send no OPT record, which caps the response at 512 bytes. */
  readonly ednsBufferSize?: number;
  readonly name: string;
  readonly recursionDesired?: boolean;
  /** Default true. Set false to observe the TC bit rather than resolve past it. */
  readonly retryOverTcp?: boolean;
  readonly target: ServerAddress;
  readonly timeoutMs?: number;
  readonly type: number;
}
