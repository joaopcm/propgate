/**
 * Test-side helpers for talking to the fixture tier.
 *
 * Phase 1 replaces `fixtureResolver` with a real @propgate/dns resolver
 * constructed against these same addresses; the signature is deliberately the
 * shape that resolver's options will take, so specs written now do not need
 * rewriting later.
 */
import { Resolver } from "node:dns/promises";
import {
  FIXTURE_ROOT_HINTS,
  FIXTURE_SERVERS,
  type FixtureRole,
} from "./manifest";

/**
 * Tests use a short deadline so the fixtures that depend on something *not*
 * answering (the stale-NS glue at 127.0.0.9) stay fast. Timeout-bound fixtures
 * are where wall-clock time and flakiness enter a suite, so there is exactly one
 * of them and it resolves in a quarter second.
 */
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

/**
 * A node:dns resolver aimed at one fixture server. Adequate for coarse
 * assertions and for readiness probing; insufficient for anything the taxonomy
 * actually cares about (truncation, DNSSEC state, authority-section SOA), which
 * is why Phase 1 brings its own codec.
 */
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

/**
 * A label no other test has used.
 *
 * Unbound's cache is shared mutable state across parallel test files. Rather
 * than serialising the whole suite for it, cache-sensitive assertions use a
 * fresh QNAME. Reserve an explicit cache flush for the `dns-serial` project.
 */
export function uniqueLabel(prefix = "probe"): string {
  labelCounter += 1;
  return `${prefix}-${process.pid.toString(36)}-${labelCounter.toString(36)}`;
}
