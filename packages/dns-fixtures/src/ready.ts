/**
 * Readiness and staleness checks, run from globalSetup.
 *
 * Note the deliberate exception to the repo's own rule: this file uses Node's
 * `dns.Resolver` (c-ares). That is fine *here* because these are liveness probes,
 * not product behaviour. c-ares cannot expose the TC bit, set DO, read the
 * authority-section SOA of an NXDOMAIN, control the EDNS buffer size, or return
 * RRSIGs — which is exactly why @propgate/dns needs its own wire codec. Do not
 * reach for node:dns anywhere in the resolver or the evaluators.
 */

import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANARY_NAME,
  FIXTURE_SERVERS,
  type FixtureRole,
  type FixtureServer,
} from "./manifest";

const READINESS_TIMEOUT_MS = 5000;
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * What to ask each server. Chosen so a pass means the server is doing its actual
 * job, not merely holding a socket open — the resolver probe asserts the whole
 * chain of trust, and the permissive probe asserts the bogus zone still resolves.
 */
const PROBES: Readonly<
  Record<FixtureRole, { name: string; type: "SOA" | "TXT" }>
> = {
  auth: { name: CANARY_NAME, type: "TXT" },
  decoy: { name: "decoy.test", type: "SOA" },
  divergent: { name: "divergent.test", type: "SOA" },
  permissive: { name: "bogus-zone.test", type: "TXT" },
  resolver: { name: "secure.test", type: "SOA" },
  root: { name: "test", type: "SOA" },
};

function resolverFor(server: FixtureServer, timeoutMs: number): Resolver {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  resolver.setServers([`${server.address}:${server.port}`]);
  return resolver;
}

export function readCommittedRevision(): string {
  return readFileSync(join(PACKAGE_ROOT, "REVISION"), "utf8").trim();
}

async function probe(
  server: FixtureServer,
  timeoutMs: number
): Promise<string[]> {
  const resolver = resolverFor(server, timeoutMs);
  const { name, type } = PROBES[server.role];

  if (type === "TXT") {
    const records = await resolver.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  }

  const soa = await resolver.resolveSoa(name);
  return [soa.hostmaster];
}

/**
 * Throws with an actionable message if any fixture server is unreachable or not
 * answering correctly. Runs all six concurrently — a serial walk would take six
 * timeouts to report a fully-down tier.
 */
export async function assertFixturesReady(
  timeoutMs = READINESS_TIMEOUT_MS
): Promise<void> {
  const results = await Promise.allSettled(
    Object.values(FIXTURE_SERVERS).map(async (server) => {
      await probe(server, timeoutMs);
      return server.role;
    })
  );

  const broken = Object.values(FIXTURE_SERVERS)
    .map((server, index) => ({ result: results[index], server }))
    .filter((entry) => entry.result?.status === "rejected");

  if (broken.length === 0) {
    return;
  }

  const detail = broken
    .map(({ server, result }) => {
      const reason =
        result?.status === "rejected" ? String(result.reason) : "unknown";
      return `  ${server.role} (${server.address}:${server.port}) — ${reason}\n    ${server.description}`;
    })
    .join("\n");

  throw new Error(
    `DNS fixtures unreachable — run \`pnpm dns:up\`.\n\n${detail}\n\n` +
      "If they are running, check: nothing else is bound to these loopback\n" +
      "addresses, and on macOS use docker-compose.darwin.yml (only 127.0.0.1\n" +
      "is up on Darwin)."
  );
}

/**
 * Throws if the running containers are serving a different zones/ revision than
 * the working tree. This is the single highest-value guard in the harness:
 * without it, editing a zone file and forgetting to reload produces a test
 * failure that looks like a code bug and costs an afternoon.
 */
export async function assertFixturesFresh(
  timeoutMs = READINESS_TIMEOUT_MS
): Promise<void> {
  const expected = readCommittedRevision();
  const [served] = await probe(FIXTURE_SERVERS.auth, timeoutMs);

  if (served === expected) {
    return;
  }

  throw new Error(
    "DNS fixture containers are stale — run `pnpm dns:up` (add --build if the image changed).\n\n" +
      `  serving:  ${served ?? "<nothing>"}\n` +
      `  expected: ${expected}\n\n` +
      "If you just edited a zone file, run `pnpm dns:reload` to recompute the\n" +
      "revision and signal the servers."
  );
}
