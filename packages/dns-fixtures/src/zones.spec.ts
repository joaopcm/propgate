import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_EXPECTATIONS } from "./expectations";
import { readCommittedRevision } from "./ready";

/**
 * Integrity of the fixtures themselves. Static file assertions — no containers,
 * so these run everywhere and are the first thing to look at when the harness
 * misbehaves.
 *
 * These exist because a silently-broken fixture is worse than a missing one: the
 * suite goes green while testing nothing. Each check below corresponds to a way
 * that has actually happened or nearly happened.
 */

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ZONES = join(PACKAGE_ROOT, "zones");
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function zoneFilesIn(dir: string): string[] {
  try {
    return readdirSync(join(ZONES, dir)).filter(
      (file) => file.endsWith(".zone") || file.endsWith(".zone.signed")
    );
  } catch {
    return [];
  }
}

function zoneNameOf(file: string): string {
  return basename(basename(file, ".signed"), ".zone");
}

function read(...parts: string[]): string {
  return readFileSync(join(ZONES, ...parts), "utf8");
}

const TEST_SUFFIX = /\.test$/;
const WHITESPACE = /\s+/;

/**
 * Whether `zoneText` delegates the child sitting at `ownerLabel`.
 *
 * Line-based rather than a built regex: the owner name comes from a filename, so
 * a regex would need escaping, and "first field on the line, then IN NS" is what
 * we actually mean.
 */
function hasDelegation(zoneText: string, ownerLabel: string): boolean {
  return zoneText
    .split("\n")
    .some(
      (line) =>
        line.split(WHITESPACE)[0] === ownerLabel && line.includes("IN NS")
    );
}

/** Every zone dns-auth serves, mapped to the text of its file. */
function servedZones(): Map<string, string> {
  const served = new Map<string, string>();

  for (const dir of ["unsigned", "signed/auth"]) {
    for (const file of zoneFilesIn(dir)) {
      served.set(zoneNameOf(file), read(dir, file));
    }
  }

  return served;
}

/** RRSIG rdata is: type alg labels origTTL expiration inception keytag signer. */
function rrsigExpirations(zoneText: string): number[] {
  const matches = zoneText.matchAll(/^\s+(\d{14}) (\d{14}) \d+ /gm);
  const stamps: number[] = [];

  for (const match of matches) {
    const raw = match[1] ?? "";
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`;
    stamps.push(Date.parse(iso));
  }

  return stamps;
}

describe("fixture delegation graph", () => {
  it("delegates every dns-auth zone from its parent", () => {
    const testZone = read("src", "test.zone");
    const served = servedZones();

    // Usually the parent is test.zone. A zone cut one level deeper —
    // inner.caa-child.test — is delegated from its own parent's file instead,
    // with an owner name relative to that parent. Demanding a delegation in
    // test.zone for those would demand a record that would be wrong to write.
    const undelegated = [...served.keys()].filter((zone) => {
      const [label, ...rest] = zone.split(".");
      const parent = served.get(rest.join("."));

      return parent
        ? !hasDelegation(parent, label ?? "")
        : !hasDelegation(testZone, zone.replace(TEST_SUFFIX, ""));
    });

    expect(undelegated).toEqual([]);
  });

  it("carries every delegation into the signed copy the root actually serves", () => {
    // dns-root serves signed/root/test.zone.signed, not zones/src/test.zone.
    // Adding a delegation to the source and not re-signing leaves the new zone
    // reachable by querying dns-auth directly and invisible to the recursive
    // tier — which looks like a resolver bug and is not one. This bit once,
    // silently, and only showed up when a fixture needed the resolver.
    const source = read("src", "test.zone");
    const signed = read("signed", "root", "test.zone.signed");

    const delegated = new Set(
      source
        .split("\n")
        .filter((line) => !line.startsWith(";") && line.includes("IN NS"))
        .map((line) => line.split(WHITESPACE)[0])
        .filter((label) => label !== undefined && label !== "@")
    );

    const missing = [...delegated].filter(
      (label) =>
        !signed
          .split("\n")
          .some(
            (line) => line.startsWith(`${label}.test.`) && line.includes(" NS")
          )
    );

    expect(
      missing,
      "run `pnpm dns:sign` — the signed root is missing these delegations"
    ).toEqual([]);
  });

  it("keeps the PSL zones out of the fake root on purpose", () => {
    // example.co.uk and user.github.io are reachable only by querying dns-auth
    // directly. The fake root has no uk. or com., and inventing one would model
    // the wrong thing — see the header comment in zones/psl/example.co.uk.zone.
    const testZone = read("src", "test.zone");

    for (const file of zoneFilesIn("psl")) {
      expect(testZone).not.toContain(zoneNameOf(file));
    }
  });

  it("has a DS record for every signed child and none for the insecure island", () => {
    const testZone = read("src", "test.zone");

    for (const file of zoneFilesIn("signed/auth")) {
      expect(testZone).toContain(`${zoneNameOf(file)}.\t`);
    }

    // The whole point of insecure-island.test is the absent DS. If a DS ever
    // appears here, the zone stops testing anything.
    const dsOwners = testZone
      .split("\n")
      .filter((line) => line.includes("IN DS"))
      .map((line) => line.split(WHITESPACE)[0]);

    expect(dsOwners).not.toContain("insecure-island.test.");
  });
});

describe("signed fixture validity windows", () => {
  it("keeps good zones far from expiry, so the suite warns years early", () => {
    const deadline = Date.now() + ONE_YEAR_MS;

    for (const file of [
      ...zoneFilesIn("signed/auth"),
      ...zoneFilesIn("signed/root"),
    ]) {
      const dir = zoneFilesIn("signed/auth").includes(file)
        ? "signed/auth"
        : "signed/root";
      const expirations = rrsigExpirations(read(dir, file));

      expect(expirations.length, `${file} has no RRSIGs`).toBeGreaterThan(0);
      expect(
        Math.min(...expirations),
        `${file} has an RRSIG expiring within a year — run \`pnpm dns:sign\``
      ).toBeGreaterThan(deadline);
    }
  });
});

describe("committed REVISION", () => {
  it("matches the current contents of zones/", () => {
    const computed = execFileSync(
      process.execPath,
      [join(PACKAGE_ROOT, "scripts", "revision.mjs")],
      { encoding: "utf8" }
    ).trim();

    expect(
      readCommittedRevision(),
      "REVISION is out of date — run `pnpm dns:revision`"
    ).toBe(computed);
  });
});

describe("fixture expectations table", () => {
  it("references only zones that exist, or delegations that do", () => {
    const zoneNames = new Set(
      [
        ...zoneFilesIn("unsigned"),
        ...zoneFilesIn("signed/auth"),
        ...zoneFilesIn("signed/root"),
        ...zoneFilesIn("decoy"),
        ...zoneFilesIn("divergent"),
        ...zoneFilesIn("psl"),
      ].map(zoneNameOf)
    );

    const testZone = read("src", "test.zone");

    const dangling = FIXTURE_EXPECTATIONS.filter((row) => {
      if (zoneNames.has(row.zone)) {
        return false;
      }
      // lame.test has no zone file anywhere by design — it exists purely as a
      // delegation pointing at a server that is not authoritative for it.
      return !hasDelegation(testZone, row.zone.replace(TEST_SUFFIX, ""));
    }).map((row) => row.zone);

    expect(dangling).toEqual([]);
  });

  it("gives every fixture a reason", () => {
    for (const row of FIXTURE_EXPECTATIONS) {
      expect(row.reason.length, `${row.zone} needs a reason`).toBeGreaterThan(
        30
      );
    }
  });
});
