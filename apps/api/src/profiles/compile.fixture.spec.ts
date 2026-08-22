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

  return attributeResults(definition, result, expectations);
}

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

    expect(overallVerdict(attributeResults(definition, result, null))).toBe(
      "indeterminate"
    );
  });
});

describe("a per-domain DKIM key against the zone that publishes it", () => {
  it("passes when the domain's own key is the one published", async () => {
    const attributed = await evaluate("customer.test", DEFERS_KEY, {
      dkim: { expectedPublicKey: await publishedKey("pg1", "customer.test") },
    });

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "pass" });
  });

  it("fails with a mismatch when a different valid key is expected", async () => {
    const attributed = await evaluate("customer.test", DEFERS_KEY, {
      dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8ANOTTHEKEY" },
    });

    expect(attributed[0]?.verdict).toBe("fail");
    expect(attributed[0]?.findings.map((entry) => entry.code)).toContain(
      "DKIM_KEY_MISMATCH"
    );
  });

  it("fails when the key differs only in letter case", async () => {
    const key = await publishedKey("pg1", "customer.test");
    const attributed = await evaluate("customer.test", DEFERS_KEY, {
      dkim: { expectedPublicKey: key.toLowerCase() },
    });

    expect(attributed[0]?.verdict).toBe("fail");
  });

  it("attributes a deferred selector's outcome to its requirement", async () => {
    const attributed = await evaluate(
      "customer.test",
      {
        requirements: [
          { check: "dkim", key: "dkim", requiredPerDomain: ["selector"] },
        ],
      },
      { dkim: { selector: "pg1" } }
    );

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "pass" });
  });

  it("does not pass when the required key was never supplied", () => {
    const compiled = compileProfile(DEFERS_KEY, "version-1", null);

    expect(compiled.kind).toBe("incomplete");
  });
});

const RETURN_PATH: ProfileDefinition = {
  requirements: [
    { check: "dkim", key: "dkim", selector: "pg1" },
    { check: "dmarc", key: "dmarc" },
    { check: "mx", expectsMail: false, key: "apex-mail" },
    { check: "spf", include: "one.spf.test", key: "bounce-spf", label: "send" },
    { check: "mx", expectsMail: true, key: "bounce-mx", label: "send" },
  ],
};

describe("a platform that sends from a bounce host", () => {
  it("satisfies every requirement from one profile and one domain", async () => {
    const attributed = await evaluate("customer.test", RETURN_PATH);

    expect(attributed.map((entry) => entry.key)).toEqual([
      "dkim",
      "dmarc",
      "apex-mail",
      "bounce-spf",
      "bounce-mx",
    ]);
    expect(attributed.every((entry) => entry.satisfied)).toBe(true);
  });

  it("files each name's answer against the requirement that asked for it", async () => {
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "mx", expectsMail: true, key: "apex-mail" },
        { check: "mx", expectsMail: true, key: "bounce-mx", label: "send" },
      ],
    });

    expect(attributed.find((entry) => entry.key === "apex-mail")).toMatchObject(
      { satisfied: false }
    );
    expect(attributed.find((entry) => entry.key === "bounce-mx")).toMatchObject(
      { satisfied: true }
    );
  });

  it("names the labelled record in the finding, not the domain", async () => {
    const attributed = await evaluate("customer.test", {
      requirements: [
        {
          check: "spf",
          include: "one.spf.test",
          key: "bounce-spf",
          label: "nothing-here",
        },
      ],
    });

    expect(attributed[0]?.findings[0]?.name).toBe("nothing-here.customer.test");
  });
});
