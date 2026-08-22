export const FIXTURE_ROLES = [
  "root",
  "auth",
  "decoy",
  "resolver",
  "permissive",
  "divergent",
] as const;

export type FixtureRole = (typeof FIXTURE_ROLES)[number];

export interface FixtureServer {
  readonly address: string;
  readonly description: string;
  readonly port: number;
  readonly recursive: boolean;
  readonly role: FixtureRole;
}

const DEFAULT_PORT = 53;

function portFor(role: FixtureRole, fallback: number): number {
  const explicit = process.env[`PROPGATE_FIXTURE_${role.toUpperCase()}_PORT`];

  if (explicit) {
    return Number(explicit);
  }

  const offset = process.env.PROPGATE_FIXTURE_PORT_OFFSET;

  return offset ? Number(offset) + fallback : DEFAULT_PORT;
}

function addressFor(role: FixtureRole, fallback: string): string {
  return process.env[`PROPGATE_FIXTURE_${role.toUpperCase()}`] ?? fallback;
}

export const FIXTURE_SERVERS: Readonly<Record<FixtureRole, FixtureServer>> = {
  auth: {
    address: addressFor("auth", "127.0.0.3"),
    description: "NSD — every *.test child fixture zone, plus the PSL zones.",
    port: portFor("auth", 3),
    recursive: false,
    role: "auth",
  },
  decoy: {
    address: addressFor("decoy", "127.0.0.4"),
    description:
      "NSD — decoy.test only, so lame.test gets a genuine REFUSED rather than a timeout.",
    port: portFor("decoy", 4),
    recursive: false,
    role: "decoy",
  },
  divergent: {
    address: addressFor("divergent", "127.0.0.8"),
    description:
      "NSD — deliberately different answers, for consensus and hysteresis work.",
    port: portFor("divergent", 8),
    recursive: false,
    role: "divergent",
  },
  permissive: {
    address: addressFor("permissive", "127.0.0.7"),
    description:
      "Unbound — iterator only. Bogus zones resolve here. The differential against `resolver` is what proves validation.",
    port: portFor("permissive", 7),
    recursive: true,
    role: "permissive",
  },
  resolver: {
    address: addressFor("resolver", "127.0.0.6"),
    description:
      "Unbound — validating, anchored on the fake root KSK. Bogus zones SERVFAIL here.",
    port: portFor("resolver", 6),
    recursive: true,
    role: "resolver",
  },
  root: {
    address: addressFor("root", "127.0.0.2"),
    description: "NSD — the signed fake root and test.",
    port: portFor("root", 2),
    recursive: false,
    role: "root",
  },
};

export const FIXTURE_ROOT_HINTS = [
  {
    address: FIXTURE_SERVERS.root.address,
    name: "ns0.test.",
    port: FIXTURE_SERVERS.root.port,
  },
] as const;

export const CANARY_NAME = "_rev.canary.test";

export const DNSSEC_CONTROL_ZONE = "secure.test";

export const DNSSEC_BOGUS_ZONE = "bogus-zone.test";
