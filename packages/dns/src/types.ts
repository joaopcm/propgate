/**
 * Transport and addressing types.
 *
 * Every address is `{ address, port, transport }` and `port` is never assumed
 * to be 53. The fixture harness serves real port 53 on distinct 127.0.0.x
 * loopback addresses precisely so delegation-following works without a shim —
 * DNS glue records carry an address but no port, so a resolver that hardcodes
 * 53 and a harness that serves high ports cannot both be right. On macOS,
 * where only 127.0.0.1 is up, the compose override publishes high ports and
 * `addressRewrite` is the single seam that maps glue addresses onto them.
 */

export type Transport = "udp" | "tcp";

export const DEFAULT_DNS_PORT = 53;

export interface ServerAddress {
  readonly address: string;
  readonly port?: number;
  readonly transport?: Transport;
}

export interface RootHint {
  readonly address: string;
  /** Fully-qualified nameserver name, with trailing dot. */
  readonly name: string;
  readonly port?: number;
}

/**
 * Rewrites an address discovered mid-resolution (from glue, or from resolving
 * an NS target) before it is dialled. Returning the input unchanged is the
 * production behaviour; the macOS fixture override is the only intended
 * consumer. Keep this out of the hot path in every other case.
 */
export type AddressRewrite = (target: ServerAddress) => ServerAddress;

export interface ResolverOptions {
  readonly addressRewrite?: AddressRewrite;
  /** Set DO to request DNSSEC records. */
  readonly dnssecOk?: boolean;
  /**
   * EDNS0 advertised UDP payload size. Omit entirely to send no OPT record,
   * which caps the response at 512 bytes by protocol and is how truncation is
   * driven from the client rather than by tuning the server.
   */
  readonly ednsBufferSize?: number;
  /** Vendored IANA root hints in production; the fake signed root in tests. */
  readonly rootHints?: readonly RootHint[];
  /** Per-query deadline. Tests run at ~250ms so blackhole fixtures stay fast. */
  readonly timeoutMs?: number;
}

export function resolvePort(target: ServerAddress): number {
  return target.port ?? DEFAULT_DNS_PORT;
}
