import type { ServerAddress, Transport } from "../types";
import type { Message } from "../wire/message";

export type QueryOutcome =
  | {
      readonly status: "answered";
      readonly message: Message;
      readonly transport: Transport;
      readonly retriedOverTcp: boolean;
      readonly elapsedMs: number;
    }
  | {
      readonly status: "timeout";
      readonly transport: Transport;
      readonly timeoutMs: number;
      readonly elapsedMs: number;
      readonly retriedOverTcp: boolean;
    }
  | {
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
      readonly status: "truncated";
      readonly message: Message;
      readonly transport: "udp";
      readonly elapsedMs: number;
    };

export interface QuerySpec {
  readonly checkingDisabled?: boolean;
  readonly dnssecOk?: boolean;
  readonly ednsBufferSize?: number;
  readonly name: string;
  readonly recursionDesired?: boolean;
  readonly retryOverTcp?: boolean;
  readonly target: ServerAddress;
  readonly timeoutMs?: number;
  readonly type: number;
}
