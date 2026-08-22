export type Transport = "udp" | "tcp";

export const DEFAULT_DNS_PORT = 53;

export interface ServerAddress {
  readonly address: string;
  readonly port?: number;
  readonly transport?: Transport;
}

export interface RootHint {
  readonly address: string;
  readonly name: string;
  readonly port?: number;
}

export type AddressRewrite = (target: ServerAddress) => ServerAddress;

export interface ResolverOptions {
  readonly addressRewrite?: AddressRewrite;
  readonly dnssecOk?: boolean;
  readonly ednsBufferSize?: number;
  readonly rootHints?: readonly RootHint[];
  readonly timeoutMs?: number;
}

export function resolvePort(target: ServerAddress): number {
  return target.port ?? DEFAULT_DNS_PORT;
}
