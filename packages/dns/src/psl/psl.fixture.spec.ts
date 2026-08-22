import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { query } from "../transport/query";
import type { ServerAddress } from "../types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { getRegistrableDomain } from "./index";

const TIMEOUT_MS = 2000;

function auth(): ServerAddress {
  const fixture = fixtureTarget("auth");
  return { address: fixture.address, port: fixture.port };
}

async function txt(name: string): Promise<string[]> {
  const outcome = await query({
    name,
    target: auth(),
    timeoutMs: TIMEOUT_MS,
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    throw new Error(`expected an answer for ${name}, got ${outcome.status}`);
  }

  return recordsOfType(outcome.message.answers, "TXT").map(
    (record) => record.rdata.value
  );
}

describe("DMARC lookup at the organizational domain", () => {
  it("finds the policy via the org domain of a multi-label public suffix", async () => {
    const queried = "sub.example.co.uk";
    const org = getRegistrableDomain(queried);

    expect(org).toBe("example.co.uk");

    const [policy] = await txt(`_dmarc.${org}`);
    expect(policy).toContain("v=DMARC1");
    expect(policy).toContain("p=reject");
    expect(policy).toContain("sp=quarantine");
  });

  it("has distinct policies at the subdomain and the org domain", async () => {
    const [atSubdomain] = await txt("_dmarc.sub.example.co.uk");
    expect(atSubdomain).toContain("p=none");

    const [atOrg] = await txt("_dmarc.example.co.uk");
    expect(atOrg).toContain("p=reject");
    expect(atOrg).toContain("sp=quarantine");

    expect(atSubdomain).not.toBe(atOrg);
  });

  it("never falls back past the org domain to the public suffix", () => {
    expect(getRegistrableDomain("_dmarc.co.uk")).toBe("_dmarc.co.uk");
    expect(getRegistrableDomain("co.uk")).toBeNull();
  });
});

describe("the private section against a real zone", () => {
  it("treats user.github.io as its own organizational domain", async () => {
    const org = getRegistrableDomain("user.github.io");

    expect(org).toBe("user.github.io");

    const outcome = await query({
      name: org ?? "",
      target: auth(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.CAA,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const caa = recordsOfType(outcome.message.answers, "CAA");
    expect(
      caa.map((record) => record.rdata.tag).sort((a, b) => a.localeCompare(b))
    ).toEqual(["issue", "issuewild"]);
  });

  it("is not what bounds CAA climbing — a second correction", () => {
    expect(getRegistrableDomain("pages.user.github.io")).toBe("user.github.io");
    expect(getRegistrableDomain("github.io")).toBeNull();
  });
});
