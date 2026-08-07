import type { DomainExpectations, ProfileDefinition } from "@propgate/db";
import {
  parseDkimRecord,
  query,
  RecordType,
  recordsOfType,
  runChecks,
} from "@propgate/dns";
import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { attributeResults, compileProfile, overallVerdict } from "./compile";

/**
 * Compilation and attribution against the real resolver.
 *
 * The unit specs hand `attributeResults` a `CheckResult` someone typed, which
 * proves the filing but not that the shape is the one the evaluators actually
 * return. This is the half that would still pass if the two drifted.
 */

const TIMEOUT_MS = 2000;

function target() {
  const fixture = fixtureTarget("resolver");

  return { address: fixture.address, port: fixture.port };
}

async function evaluate(
  domain: string,
  definition: ProfileDefinition,
  expectations: DomainExpectations | null = null
) {
  const compiled = compileProfile(definition, "version-1", expectations);

  if (compiled.kind !== "runnable") {
    throw new Error(
      `expected a runnable profile, got missing ${JSON.stringify(compiled.missing)}`
    );
  }

  const result = await runChecks({
    domain,
    profile: compiled.profile,
    resolver: {
      maxLookups: 60,
      recursionDesired: true,
      target: target(),
      timeoutMs: TIMEOUT_MS,
    },
  });

  return attributeResults(definition, result);
}

/**
 * The key `customer.test` actually publishes, read from the zone at run time.
 *
 * Deliberately discovered rather than pasted into this file. A hardcoded copy is
 * a second source of truth that goes stale the next time the fixtures are
 * re-signed, and the test that would then fail is the one asserting a *match* —
 * so it would look like the merge broke rather than like the constant did.
 */
async function publishedKey(selector: string, domain: string): Promise<string> {
  const outcome = await query({
    name: `${selector}._domainkey.${domain}`,
    recursionDesired: true,
    target: target(),
    timeoutMs: TIMEOUT_MS,
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    throw new Error(`fixture lookup was ${outcome.status}`);
  }

  // `value` is the RFC 6763 concatenation. A key this long is always published
  // as two character-strings, and the split is not what this test is about.
  const [record] = recordsOfType(outcome.message.answers, "TXT");
  const parsed = parseDkimRecord(record?.rdata.value ?? "");

  if (!parsed.ok) {
    throw new Error(`fixture DKIM record did not parse: ${parsed.detail}`);
  }

  return parsed.record.publicKeyBase64;
}

const DEFERS_KEY: ProfileDefinition = {
  requirements: [
    {
      check: "dkim",
      key: "dkim",
      requiredPerDomain: ["expectedPublicKey"],
      selector: "pg1",
    },
  ],
};

describe("a partner's profile against a correctly configured customer", () => {
  it("reports every requirement met", async () => {
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "spf", include: "one.spf.test", key: "spf" },
        { check: "dkim", key: "dkim", selector: "pg1" },
        { check: "dmarc", key: "dmarc" },
        { check: "mx", expectsMail: false, key: "mail" },
      ],
    });

    expect(attributed.filter((entry) => entry.satisfied)).toHaveLength(4);
    expect(overallVerdict(attributed)).not.toBe("fail");
  });

  it("names the one requirement that is unmet, and only that one", async () => {
    // "3 of 4 requirements met", with the missing one identified — which is
    // what the product promises without rendering instructions.
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "spf", include: "one.spf.test", key: "spf" },
        { check: "dkim", key: "dkim-issued", selector: "pg1" },
        { check: "dkim", key: "dkim-rotated", selector: "pg2" },
        { check: "dmarc", key: "dmarc" },
      ],
    });

    const unmet = attributed.filter((entry) => !entry.satisfied);

    expect(attributed).toHaveLength(4);
    expect(unmet.map((entry) => entry.key)).toEqual(["dkim-rotated"]);
    expect(unmet[0]?.findings.length).toBeGreaterThan(0);
    expect(overallVerdict(attributed)).toBe("fail");
  });

  it("keeps two selectors' findings apart, not merged", async () => {
    // Before the per-selector split this was impossible: one DKIM outcome
    // carried both selectors' findings and neither could be filed.
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "dkim", key: "issued", selector: "pg1" },
        { check: "dkim", key: "rotated", selector: "pg2" },
      ],
    });

    expect(
      attributed.find((entry) => entry.key === "issued")?.findings
    ).toEqual([]);
    expect(
      attributed.find((entry) => entry.key === "rotated")?.findings.length
    ).toBeGreaterThan(0);
  });

  it("is indeterminate, not failed, when the resolver cannot be reached", async () => {
    // The property the state machine in step 4 is built on: a domain whose
    // check could not complete keeps whatever state it had.
    const definition: ProfileDefinition = {
      requirements: [{ check: "dmarc", key: "dmarc" }],
    };
    const compiled = compileProfile(definition, "version-1", null);

    if (compiled.kind !== "runnable") {
      throw new Error("expected a runnable profile");
    }

    const result = await runChecks({
      domain: "customer.test",
      profile: compiled.profile,
      resolver: { target: { address: "127.0.0.1", port: 1 }, timeoutMs: 500 },
    });

    expect(overallVerdict(attributeResults(definition, result))).toBe(
      "indeterminate"
    );
  });
});

describe("a per-domain DKIM key against the zone that publishes it", () => {
  it("passes when the domain's own key is the one published", async () => {
    // Uses the value the zone really serves, so this proves the merge reaches
    // the *evaluator* rather than merely producing the right-looking object.
    const attributed = await evaluate("customer.test", DEFERS_KEY, {
      dkim: { expectedPublicKey: await publishedKey("pg1", "customer.test") },
    });

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "pass" });
  });

  it("fails with a mismatch when a different valid key is expected", async () => {
    // The domain that pasted a competitor's record. Without the expectation this
    // zone passes, because a valid key really is published here.
    const attributed = await evaluate("customer.test", DEFERS_KEY, {
      dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8ANOTTHEKEY" },
    });

    expect(attributed[0]?.verdict).toBe("fail");
    expect(attributed[0]?.findings.map((entry) => entry.code)).toContain(
      "DKIM_KEY_MISMATCH"
    );
  });

  it("fails when the key differs only in letter case", async () => {
    /**
     * DNS names fold case; base64 does not.
     *
     * `pg1._domainkey` and `PG1._domainkey` are the same query, but a key
     * differing in case is a different key and cannot sign anything. Comparing
     * case-insensitively here would pass a domain whose DKIM is broken.
     */
    const key = await publishedKey("pg1", "customer.test");
    const attributed = await evaluate("customer.test", DEFERS_KEY, {
      dkim: { expectedPublicKey: key.toLowerCase() },
    });

    expect(attributed[0]?.verdict).toBe("fail");
  });

  it("does not pass when the required key was never supplied", () => {
    /**
     * The one test that separates the design from the bug it replaced.
     *
     * `customer.test` publishes a perfectly valid key at `pg1`, so the old
     * behaviour — collapsing an absent expectation into the bare selector
     * spelling — reported this exact profile and this exact domain as `pass`.
     * Per invariant 1 a mocked resolver would have agreed with whichever of those
     * two answers we believed when we wrote the mock; only the real zone can tell
     * them apart.
     */
    const compiled = compileProfile(DEFERS_KEY, "version-1", null);

    expect(compiled.kind).toBe("incomplete");
  });
});
