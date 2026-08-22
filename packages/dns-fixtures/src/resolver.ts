import { Resolver } from "node:dns/promises";
import {
  FIXTURE_ROOT_HINTS,
  FIXTURE_SERVERS,
  type FixtureRole,
} from "./manifest";

export const FIXTURE_QUERY_TIMEOUT_MS = 250;

export interface FixtureTarget {
  readonly address: string;
  readonly port: number;
  readonly recursive: boolean;
  readonly rootHints: typeof FIXTURE_ROOT_HINTS;
}

export function fixtureTarget(role: FixtureRole): FixtureTarget {
  const server = FIXTURE_SERVERS[role];

  return {
    address: server.address,
    port: server.port,
    recursive: server.recursive,
    rootHints: FIXTURE_ROOT_HINTS,
  };
}

export function fixtureResolver(
  role: FixtureRole,
  timeoutMs = FIXTURE_QUERY_TIMEOUT_MS
): Resolver {
  const server = FIXTURE_SERVERS[role];
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  resolver.setServers([`${server.address}:${server.port}`]);
  return resolver;
}

let labelCounter = 0;

export function uniqueLabel(prefix = "probe"): string {
  labelCounter += 1;
  return `${prefix}-${process.pid.toString(36)}-${labelCounter.toString(36)}`;
}
